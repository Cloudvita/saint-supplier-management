import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { graphEdges, graphNodes, type GraphNode } from "../schema";
import { EDGE_TYPES, MAX_ASSEMBLY_DEPTH, MAX_NEIGHBOURHOOD_DEPTH } from "../domain/graph-model";

/**
 * Reads over the product graph tables. The analyses in product.service.ts are
 * written against these functions, never against SQL, so the queries that
 * replace PMem's Cypher live in one place.
 */

type NodeRow = Pick<GraphNode, "id" | "name" | "className" | "sourceTag" | "rflpLayer" | "sourceId" | "properties">;

const nodeColumns = {
  id: graphNodes.id,
  name: graphNodes.name,
  className: graphNodes.className,
  sourceTag: graphNodes.sourceTag,
  rflpLayer: graphNodes.rflpLayer,
  sourceId: graphNodes.sourceId,
  properties: graphNodes.properties,
};

/** `%text%` for ILIKE, with the user's own % and _ taken literally. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Nodes whose name, or id in their source file, contains the text. Exact
 * names first, then prefixes, then shorter names — the order a person
 * scanning results expects.
 */
export async function findNodes(text: string, limit: number, classNames?: string[]): Promise<NodeRow[]> {
  const q = text.trim().toLowerCase();
  const pattern = containsPattern(q);
  const match = or(sql`lower(${graphNodes.name}) like ${pattern}`, sql`lower(${graphNodes.externalKey}) like ${pattern}`);
  return db
    .select(nodeColumns)
    .from(graphNodes)
    .where(classNames?.length ? and(match, inArray(graphNodes.className, classNames)) : match)
    .orderBy(
      sql`(lower(${graphNodes.name}) = ${q}) desc`,
      sql`(lower(${graphNodes.name}) like ${`${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}) desc`,
      sql`length(${graphNodes.name})`,
      asc(graphNodes.name)
    )
    .limit(limit);
}

/** How many edges touch each node, for choosing among nodes that match equally. */
export async function degrees(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = (await db.execute(sql`
    select n.id, (select count(*) from ${graphEdges} e where e.from_id = n.id or e.to_id = n.id)::int as degree
    from ${graphNodes} n where n.id in ${ids}
  `)) as unknown as Array<{ id: string; degree: number }>;
  return new Map(rows.map((r) => [r.id, Number(r.degree)]));
}

/**
 * Part numbers from a document that the graph already holds in other
 * sources, grouped by source — the duplicates an import would create.
 */
export async function existingKeys(keys: string[]): Promise<Array<{ sourceId: string; sourceName: string; keys: string[] }>> {
  if (keys.length === 0) return [];
  const rows = (await db.execute(sql`
    select s.id as source_id, s.name as source_name, array_agg(n.external_key order by n.external_key) as keys
    from ${graphNodes} n join graph_sources s on s.id = n.source_id
    where n.external_key in ${keys}
    group by s.id, s.name
    order by count(*) desc
  `)) as unknown as Array<{ source_id: string; source_name: string; keys: string[] }>;
  return rows.map((r) => ({ sourceId: r.source_id, sourceName: r.source_name, keys: r.keys }));
}

export async function getNode(id: string): Promise<NodeRow | null> {
  const [row] = await db.select(nodeColumns).from(graphNodes).where(eq(graphNodes.id, id));
  return row ?? null;
}

export type DirectLink = {
  edgeId: string;
  type: string;
  direction: "out" | "in";
  /** The queried node this link hangs off. */
  fromNodeId: string;
  edgeProperties: Record<string, unknown>;
  node: NodeRow;
};

/** Edges touching the given nodes, with the node at the other end. */
export async function directLinks(
  ids: string[],
  opts: { types?: string[]; excludeTypes?: string[]; limit?: number } = {}
): Promise<DirectLink[]> {
  if (ids.length === 0) return [];
  const other = alias(graphNodes, "other");
  const typeFilter = and(
    opts.types?.length ? inArray(graphEdges.type, opts.types) : undefined,
    opts.excludeTypes?.length ? sql`${graphEdges.type} not in ${opts.excludeTypes}` : undefined
  );
  const pick = {
    edgeId: graphEdges.id,
    type: graphEdges.type,
    edgeProperties: graphEdges.properties,
    id: other.id,
    name: other.name,
    className: other.className,
    sourceTag: other.sourceTag,
    rflpLayer: other.rflpLayer,
    sourceId: other.sourceId,
    properties: other.properties,
  };
  const limit = opts.limit ?? 500;
  const [outgoing, incoming] = await Promise.all([
    db
      .select({ ...pick, anchor: graphEdges.fromId })
      .from(graphEdges)
      .innerJoin(other, eq(other.id, graphEdges.toId))
      .where(and(inArray(graphEdges.fromId, ids), typeFilter))
      .limit(limit),
    db
      .select({ ...pick, anchor: graphEdges.toId })
      .from(graphEdges)
      .innerJoin(other, eq(other.id, graphEdges.fromId))
      .where(and(inArray(graphEdges.toId, ids), typeFilter))
      .limit(limit),
  ]);
  const shape = (direction: "out" | "in") => (r: (typeof outgoing)[number]): DirectLink => ({
    edgeId: r.edgeId,
    type: r.type,
    direction,
    fromNodeId: r.anchor,
    edgeProperties: r.edgeProperties,
    node: {
      id: r.id,
      name: r.name,
      className: r.className,
      sourceTag: r.sourceTag,
      rflpLayer: r.rflpLayer,
      sourceId: r.sourceId,
      properties: r.properties,
    },
  });
  return [...outgoing.map(shape("out")), ...incoming.map(shape("in"))].slice(0, limit);
}

/**
 * Distinct nodes reachable from `id` within `maxDepth` hops, in either
 * direction, not counting the node itself.
 */
export async function reachableCount(id: string, maxDepth = MAX_NEIGHBOURHOOD_DEPTH): Promise<number> {
  const rows = (await db.execute(sql`
    with recursive walk(node_id, depth) as (
      select ${id}::text, 0
      union
      select case when e.from_id = w.node_id then e.to_id else e.from_id end, w.depth + 1
      from walk w
      join ${graphEdges} e on e.from_id = w.node_id or e.to_id = w.node_id
      where w.depth < ${maxDepth}
    )
    select count(distinct node_id)::int as n from walk where node_id <> ${id}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Assemblies above the given parts: follow HAS_CHILD edges from child to
 * parent, up to `maxDepth` levels. Returns each ancestor once, at its
 * shallowest depth, with the part it was reached from.
 */
export async function assemblyAncestors(ids: string[], maxDepth = MAX_ASSEMBLY_DEPTH) {
  if (ids.length === 0) return [] as Array<{ id: string; name: string; depth: number; viaPart: string }>;
  const rows = (await db.execute(sql`
    with recursive up(node_id, start_id, depth) as (
      select n.id, n.id, 0 from ${graphNodes} n where n.id in ${ids}
      union
      select e.from_id, u.start_id, u.depth + 1
      from up u
      join ${graphEdges} e on e.to_id = u.node_id and e.type = ${EDGE_TYPES.HAS_CHILD}
      where u.depth < ${maxDepth}
    )
    select distinct on (a.id) a.id, a.name, u.depth, s.name as via_part
    from up u
    join ${graphNodes} a on a.id = u.node_id
    join ${graphNodes} s on s.id = u.start_id
    where u.depth > 0
    order by a.id, u.depth
  `)) as unknown as Array<{ id: string; name: string; depth: number; via_part: string }>;
  return rows
    .map((r) => ({ id: r.id, name: r.name, depth: Number(r.depth), viaPart: r.via_part }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
}

/** Nodes from the same imported files as the given nodes (PMem's "same PLMXMLFile"). */
export async function nodesInSameSources(
  of: NodeRow[],
  opts: { classNames?: string[]; limit?: number } = {}
): Promise<NodeRow[]> {
  const sourceIds = [...new Set(of.map((n) => n.sourceId).filter((s): s is string => Boolean(s)))];
  if (sourceIds.length === 0) return [];
  const ids = of.map((n) => n.id);
  return db
    .select(nodeColumns)
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.sourceId, sourceIds),
        sql`${graphNodes.id} not in ${ids}`,
        opts.classNames?.length ? inArray(graphNodes.className, opts.classNames) : undefined
      )
    )
    .orderBy(asc(graphNodes.name))
    .limit(opts.limit ?? 500);
}

/** Other children of the same parent assemblies. */
export async function assemblySiblings(id: string, limit = 500): Promise<NodeRow[]> {
  const parent = alias(graphEdges, "parent_edge");
  const sibling = alias(graphEdges, "sibling_edge");
  return db
    .selectDistinct(nodeColumns)
    .from(parent)
    .innerJoin(sibling, and(eq(sibling.fromId, parent.fromId), eq(sibling.type, EDGE_TYPES.HAS_CHILD)))
    .innerJoin(graphNodes, eq(graphNodes.id, sibling.toId))
    .where(and(eq(parent.toId, id), eq(parent.type, EDGE_TYPES.HAS_CHILD), ne(sibling.toId, id)))
    .limit(limit);
}
