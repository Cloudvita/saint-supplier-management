// @ts-check
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { graphEdges, graphNodes, graphSources } from "../schema";
import { DEMO_MOTOR_GRAPH } from "../domain/demo-graph.js";

const log = createLogger("product.graph-writer");

/**
 * The one way nodes and edges get into the product graph.
 *
 * Every importer (STEP, CSV, PLMXML, XMI) parses its format into a
 * GraphDocument and hands it here, so validation, ids and transactions are
 * written once.
 *
 * @typedef {import("../domain/graph-document.js").GraphDocument} GraphDocument
 * @typedef {import("../schema").GraphSource} GraphSource
 */

/** Rows per INSERT: well under Postgres's 65,535 bind-parameter limit. */
const BATCH = 500;

/**
 * Write a document as a new graph source, all or nothing.
 *
 * With `replaceSourceId` the earlier source is removed in the same
 * transaction — a re-import. Nodes whose key (id in the file) is unchanged
 * keep their database id, so supplier links, requisitions and purchase
 * orders that name them still point at the same part.
 *
 * @param {GraphDocument} doc
 * @param {string} [importedBy]
 * @param {{ replaceSourceId?: string }} [opts]
 * @returns {Promise<GraphSource>}
 */
export async function writeGraph(doc, importedBy = "system", opts = {}) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const n of doc.nodes) {
    if (keys.has(n.key)) throw AppError.validation(`Duplicate node key "${n.key}" in ${doc.name}`);
    keys.add(n.key);
  }
  for (const e of doc.edges) {
    if (!keys.has(e.from) || !keys.has(e.to)) {
      throw AppError.validation(`Edge ${e.type} ${e.from} → ${e.to} names a node not in ${doc.name}`);
    }
  }

  const source = await db.transaction(async (tx) => {
    /** @type {Map<string, string>} */
    const keptIds = new Map();
    if (opts.replaceSourceId) {
      const old = await tx
        .select({ key: graphNodes.externalKey, id: graphNodes.id })
        .from(graphNodes)
        .where(eq(graphNodes.sourceId, opts.replaceSourceId));
      const deleted = await tx
        .delete(graphSources)
        .where(eq(graphSources.id, opts.replaceSourceId))
        .returning({ id: graphSources.id });
      if (deleted.length === 0) throw AppError.notFound("Graph source to replace");
      for (const o of old) if (o.key) keptIds.set(o.key, o.id);
    }

    const [src] = await tx.insert(graphSources).values({ format: doc.format, name: doc.name, importedBy }).returning();

    /** @type {Map<string, string>} */
    const idByKey = new Map();
    for (let i = 0; i < doc.nodes.length; i += BATCH) {
      const rows = await tx
        .insert(graphNodes)
        .values(
          doc.nodes.slice(i, i + BATCH).map((n) => ({
            id: keptIds.get(n.key),
            sourceId: src.id,
            externalKey: n.key,
            name: n.name,
            className: n.className ?? null,
            sourceTag: n.sourceTag ?? null,
            rflpLayer: n.rflpLayer ?? null,
            properties: n.properties ?? {},
          }))
        )
        .returning({ id: graphNodes.id, key: graphNodes.externalKey });
      for (const r of rows) if (r.key !== null) idByKey.set(r.key, r.id);
    }

    // Same type between the same two nodes is one relationship, however many
    // times the file states it.
    const edges = [...new Map(doc.edges.map((e) => [`${e.from}|${e.to}|${e.type}`, e])).values()];
    for (let i = 0; i < edges.length; i += BATCH) {
      await tx.insert(graphEdges).values(
        edges.slice(i, i + BATCH).map((e) => ({
          fromId: /** @type {string} */ (idByKey.get(e.from)),
          toId: /** @type {string} */ (idByKey.get(e.to)),
          type: e.type,
          sourceId: src.id,
          properties: e.properties ?? {},
        }))
      );
    }

    const [updated] = await tx
      .update(graphSources)
      .set({ nodeCount: doc.nodes.length, edgeCount: edges.length })
      .where(eq(graphSources.id, src.id))
      .returning();
    return updated;
  });

  log.info("graph source written", {
    sourceId: source.id,
    nodes: source.nodeCount,
    edges: source.edgeCount,
    replaced: opts.replaceSourceId ?? null,
  });
  return source;
}

/**
 * Bring a named source in line with a document, in place: nodes are matched
 * by key and updated, added or removed; the source's own edges are
 * rewritten. Unlike a replace, unchanged nodes are never deleted, so edges
 * that other sources hang on them (links added from documents to a
 * projected supplier, say) survive every sync.
 *
 * @param {GraphDocument} doc
 * @param {string} [importedBy]
 * @returns {Promise<GraphSource>}
 */
export async function syncGraphSource(doc, importedBy = "system") {
  const keys = new Set(doc.nodes.map((n) => n.key));
  if (keys.size !== doc.nodes.length) throw AppError.validation(`Duplicate node keys in ${doc.name}`);
  const [existing] = await db
    .select()
    .from(graphSources)
    .where(and(eq(graphSources.name, doc.name), eq(graphSources.format, doc.format)));
  if (!existing) return writeGraph(doc, importedBy);

  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: graphNodes.id, key: graphNodes.externalKey })
      .from(graphNodes)
      .where(eq(graphNodes.sourceId, existing.id));
    /** @type {Map<string, string>} */
    const idByKey = new Map(current.filter((c) => c.key !== null).map((c) => [/** @type {string} */ (c.key), c.id]));

    const gone = current.filter((c) => !c.key || !keys.has(c.key)).map((c) => c.id);
    for (let i = 0; i < gone.length; i += BATCH) {
      await tx.delete(graphNodes).where(inArray(graphNodes.id, gone.slice(i, i + BATCH)));
    }
    for (const n of doc.nodes) {
      const values = {
        name: n.name,
        className: n.className ?? null,
        sourceTag: n.sourceTag ?? null,
        rflpLayer: n.rflpLayer ?? null,
        properties: n.properties ?? {},
      };
      const id = idByKey.get(n.key);
      if (id) {
        await tx.update(graphNodes).set(values).where(eq(graphNodes.id, id));
      } else {
        const [row] = await tx
          .insert(graphNodes)
          .values({ ...values, sourceId: existing.id, externalKey: n.key })
          .returning({ id: graphNodes.id });
        idByKey.set(n.key, row.id);
      }
    }

    await tx.delete(graphEdges).where(eq(graphEdges.sourceId, existing.id));
    const edges = [...new Map(doc.edges.map((e) => [`${e.from}|${e.to}|${e.type}`, e])).values()];
    for (let i = 0; i < edges.length; i += BATCH) {
      await tx.insert(graphEdges).values(
        edges.slice(i, i + BATCH).map((e) => ({
          fromId: /** @type {string} */ (idByKey.get(e.from)),
          toId: /** @type {string} */ (idByKey.get(e.to)),
          type: e.type,
          sourceId: existing.id,
          properties: e.properties ?? {},
        }))
      );
    }

    const [updated] = await tx
      .update(graphSources)
      .set({ nodeCount: doc.nodes.length, edgeCount: edges.length, importedBy })
      .where(eq(graphSources.id, existing.id))
      .returning();
    log.info("graph source synced", { sourceId: updated.id, nodes: updated.nodeCount, edges: updated.edgeCount, removed: gone.length });
    return updated;
  });
}

/**
 * Add nodes and edges to a source, keeping what is already there. Nodes are
 * matched by key; an edge that already exists is left as it is. Edges may
 * name nodes of other sources by database id.
 *
 * @param {{ format: string; name: string }} source
 * @param {Array<{ key: string; name: string; className: string; properties?: Record<string, unknown> }>} nodes
 * @param {Array<{ fromId?: string; fromKey?: string; toId?: string; toKey?: string; type: string; properties?: Record<string, unknown> }>} edges
 * @param {string} [importedBy]
 * @returns {Promise<{ sourceId: string; nodeIds: Map<string, string>; edgesAdded: number }>}
 */
export async function appendToSource(source, nodes, edges, importedBy = "system") {
  return db.transaction(async (tx) => {
    let [src] = await tx
      .select()
      .from(graphSources)
      .where(and(eq(graphSources.name, source.name), eq(graphSources.format, source.format)));
    if (!src) [src] = await tx.insert(graphSources).values({ ...source, importedBy }).returning();

    /** @type {Map<string, string>} */
    const nodeIds = new Map();
    for (const n of nodes) {
      const [row] = await tx
        .insert(graphNodes)
        .values({ sourceId: src.id, externalKey: n.key, name: n.name, className: n.className, properties: n.properties ?? {} })
        .onConflictDoUpdate({
          target: [graphNodes.sourceId, graphNodes.externalKey],
          // Later documents add attributes; they do not erase earlier ones.
          set: { properties: sql`${graphNodes.properties} || excluded.properties` },
        })
        .returning({ id: graphNodes.id });
      nodeIds.set(n.key, row.id);
    }

    let edgesAdded = 0;
    for (const e of edges) {
      const fromId = e.fromId ?? nodeIds.get(e.fromKey ?? "");
      const toId = e.toId ?? nodeIds.get(e.toKey ?? "");
      if (!fromId || !toId) throw AppError.validation(`Edge ${e.type} names a node that is not in the graph`);
      const added = await tx
        .insert(graphEdges)
        .values({ fromId, toId, type: e.type, sourceId: src.id, properties: e.properties ?? {} })
        .onConflictDoNothing()
        .returning({ id: graphEdges.id });
      edgesAdded += added.length;
    }

    const [{ nodes: nodeCount }] = /** @type {Array<{ nodes: number }>} */ (
      /** @type {unknown} */ (await tx.execute(sql`select count(*)::int as nodes from ${graphNodes} where source_id = ${src.id}`))
    );
    const [{ edges: edgeCount }] = /** @type {Array<{ edges: number }>} */ (
      /** @type {unknown} */ (await tx.execute(sql`select count(*)::int as edges from ${graphEdges} where source_id = ${src.id}`))
    );
    await tx.update(graphSources).set({ nodeCount, edgeCount }).where(eq(graphSources.id, src.id));
    return { sourceId: src.id, nodeIds, edgesAdded };
  });
}

/**
 * Remove a source and, by cascade, its nodes and edges.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeGraphSource(id) {
  const deleted = await db.delete(graphSources).where(eq(graphSources.id, id)).returning({ id: graphSources.id });
  if (deleted.length === 0) throw AppError.notFound("Graph source");
}

/**
 * Load the demo motor graph into an empty graph. A no-op once anything has
 * been imported, so seeding never mixes demo data into real data.
 * @returns {Promise<boolean>}
 */
export async function seedDemoProductGraph() {
  const [{ count }] = await db.select({ count: sql`count(*)::int`.mapWith(Number) }).from(graphSources);
  if (count > 0) return false;
  await writeGraph(DEMO_MOTOR_GRAPH, "seed");
  return true;
}

/** @returns {Promise<GraphSource[]>} */
export async function listGraphSources() {
  return db.select().from(graphSources).orderBy(sql`${graphSources.createdAt} desc`);
}
