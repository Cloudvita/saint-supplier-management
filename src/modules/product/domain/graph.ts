import { z } from "zod";

/**
 * PMem's wire shapes, and the pure functions that turn them into the product
 * view SAINT works with.
 *
 * PMem answers graph queries as `{ n, r, m }` rows — a node, an optional
 * relationship and the node at its other end — straight out of Cypher. That
 * shape is a graph-visualisation format, not a domain one, so it stops here:
 * nothing outside this module ever sees a raw row.
 */

/* --------------------------- PMem wire format ---------------------------- */

const pmemNode = z.object({
  elementId: z.string(),
  labels: z.array(z.string()).default([]),
  properties: z.record(z.unknown()).default({}),
});

const pmemRelationship = z.object({
  elementId: z.string(),
  type: z.string(),
  start: z.string(),
  end: z.string(),
});

export const pmemGraphRowsSchema = z.object({
  results: z
    .array(
      z.object({
        n: pmemNode,
        r: pmemRelationship.nullish(),
        m: pmemNode.nullish(),
      })
    )
    .default([]),
});

export type PmemNode = z.infer<typeof pmemNode>;
export type PmemGraphRow = z.infer<typeof pmemGraphRowsSchema>["results"][number];

/* ----------------------------- product view ------------------------------ */

export type ProductNode = {
  /** Neo4j element id — stable for the life of the node, opaque to SAINT. */
  id: string;
  name: string;
  labels: string[];
  /** Where PMem got the node from (STEP, PLMXML, XMI ...), when it recorded it. */
  sourceTag: string | null;
  properties: Record<string, string | number | boolean>;
};

export type ProductLink = {
  relation: string;
  /** `out` when the part points at the other node, `in` when it is pointed at. */
  direction: "out" | "in";
  node: ProductNode;
};

/** Properties checked, in order, for a human-readable node name. */
const NAME_KEYS = ["name", "label", "FileName", "id"] as const;

/**
 * Graph nodes carry embeddings, raw STEP text and the like. Only short scalar
 * properties are useful to a buyer or to a model, and the rest would blow the
 * agent's context for no gain.
 */
const MAX_PROPERTIES = 25;
const MAX_STRING_LENGTH = 300;
const SKIPPED_KEYS = /embedding|vector|body_text|raw/i;

function displayName(node: PmemNode): string {
  for (const key of NAME_KEYS) {
    const value = node.properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return node.labels[0] ?? node.elementId;
}

function scalarProperties(properties: Record<string, unknown>): ProductNode["properties"] {
  const out: ProductNode["properties"] = {};
  for (const [key, value] of Object.entries(properties)) {
    if (Object.keys(out).length >= MAX_PROPERTIES) break;
    if (SKIPPED_KEYS.test(key)) continue;
    if (typeof value === "string") {
      out[key] = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function toProductNode(node: PmemNode): ProductNode {
  const sourceTag = node.properties.source_tag;
  return {
    id: node.elementId,
    name: displayName(node),
    labels: node.labels,
    sourceTag: typeof sourceTag === "string" ? sourceTag : null,
    properties: scalarProperties(node.properties),
  };
}

/** Distinct matched nodes from a search, in the order PMem ranked them. */
export function matchedNodes(rows: PmemGraphRow[], limit: number): ProductNode[] {
  const seen = new Map<string, ProductNode>();
  for (const row of rows) {
    if (seen.size >= limit) break;
    if (!seen.has(row.n.elementId)) seen.set(row.n.elementId, toProductNode(row.n));
  }
  return [...seen.values()];
}

/**
 * Split a traversal into the part's direct links and everything further out.
 *
 * PMem's traversal walks three hops and returns every row with the root as
 * `n`, so a row whose relationship does not touch the root is an indirect
 * connection. Those are counted, not listed: "what is this part attached to"
 * is the question, and the second and third hops are noise for it.
 */
export function partNeighbourhood(
  rows: PmemGraphRow[],
  partId: string,
  limit: number
): { part: ProductNode | null; links: ProductLink[]; indirectCount: number } {
  const root = rows.find((row) => row.n.elementId === partId)?.n;
  const links = new Map<string, ProductLink>();
  const indirect = new Set<string>();

  for (const row of rows) {
    if (!row.r || !row.m || row.m.elementId === partId) continue;
    const touchesRoot = row.r.start === partId || row.r.end === partId;
    if (!touchesRoot) {
      indirect.add(row.m.elementId);
      continue;
    }
    if (links.size >= limit || links.has(row.r.elementId)) continue;
    links.set(row.r.elementId, {
      relation: row.r.type,
      direction: row.r.start === partId ? "out" : "in",
      node: toProductNode(row.m),
    });
  }

  const direct = new Set([...links.values()].map((l) => l.node.id));
  return {
    part: root ? toProductNode(root) : null,
    links: [...links.values()],
    indirectCount: [...indirect].filter((id) => !direct.has(id)).length,
  };
}
