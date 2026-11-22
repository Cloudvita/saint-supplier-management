import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { graphEdges, graphNodes, graphSources, type GraphSource } from "../schema";
import { DEMO_MOTOR_GRAPH } from "../domain/demo-graph";
import type { GraphDocument } from "../domain/graph-document";

const log = createLogger("product.graph-writer");

/**
 * The one way nodes and edges get into the product graph.
 *
 * Every importer (STEP, CSV, PLMXML, XMI) parses its format into a
 * GraphDocument and hands it here, so validation, ids and transactions are
 * written once.
 */
export type { GraphDocument } from "../domain/graph-document";

/** Rows per INSERT: well under Postgres's 65,535 bind-parameter limit. */
const BATCH = 500;

/**
 * Write a document as a new graph source, all or nothing.
 *
 * With `replaceSourceId` the earlier source is removed in the same
 * transaction — a re-import. Nodes whose key (id in the file) is unchanged
 * keep their database id, so supplier links, requisitions and purchase
 * orders that name them still point at the same part.
 */
export async function writeGraph(
  doc: GraphDocument,
  importedBy = "system",
  opts: { replaceSourceId?: string } = {}
): Promise<GraphSource> {
  const keys = new Set<string>();
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
    const keptIds = new Map<string, string>();
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

    const [src] = await tx
      .insert(graphSources)
      .values({ format: doc.format, name: doc.name, importedBy })
      .returning();

    const idByKey = new Map<string, string>();
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
      for (const r of rows) idByKey.set(r.key as string, r.id);
    }

    // Same type between the same two nodes is one relationship, however many
    // times the file states it.
    const edges = [...new Map(doc.edges.map((e) => [`${e.from}|${e.to}|${e.type}`, e])).values()];
    for (let i = 0; i < edges.length; i += BATCH) {
      await tx.insert(graphEdges).values(
        edges.slice(i, i + BATCH).map((e) => ({
          fromId: idByKey.get(e.from) as string,
          toId: idByKey.get(e.to) as string,
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

/** Remove a source and, by cascade, its nodes and edges. */
export async function removeGraphSource(id: string): Promise<void> {
  const deleted = await db.delete(graphSources).where(eq(graphSources.id, id)).returning({ id: graphSources.id });
  if (deleted.length === 0) throw AppError.notFound("Graph source");
}

/**
 * Load the demo motor graph into an empty graph. A no-op once anything has
 * been imported, so seeding never mixes demo data into real data.
 */
export async function seedDemoProductGraph(): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(graphSources);
  if (count > 0) return false;
  await writeGraph(DEMO_MOTOR_GRAPH, "seed");
  return true;
}

export async function listGraphSources(): Promise<GraphSource[]> {
  return db.select().from(graphSources).orderBy(sql`${graphSources.createdAt} desc`);
}
