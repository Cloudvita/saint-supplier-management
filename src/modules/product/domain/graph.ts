import type { GraphNode } from "../schema";

/**
 * The product view of graph nodes, and the pure helpers the analyses share.
 */

export type ProductNode = {
  id: string;
  name: string;
  /** The node's ontology class as a one-element list (empty when unclassified). */
  labels: string[];
  className: string | null;
  /** The element type in the file it came from (STEP entity, PLMXML tag ...). */
  sourceTag: string | null;
  properties: Record<string, string | number | boolean>;
};

export type ProductLink = {
  relation: string;
  /** `out` when the part points at the other node, `in` when it is pointed at. */
  direction: "out" | "in";
  node: ProductNode;
};

/**
 * Imported nodes can carry raw text, geometry references and the like. Only
 * short scalar properties are useful to a buyer or a model, and the rest
 * would blow the agent's context for no gain.
 */
const MAX_PROPERTIES = 25;
const MAX_STRING_LENGTH = 300;
const SKIPPED_KEYS = /embedding|vector|body_?text|raw/i;

export function scalarProperties(properties: Record<string, unknown>): ProductNode["properties"] {
  const out: ProductNode["properties"] = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
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

export function toProductNode(node: Pick<GraphNode, "id" | "name" | "className" | "sourceTag" | "properties">): ProductNode {
  return {
    id: node.id,
    name: node.name,
    labels: node.className ? [node.className] : [],
    className: node.className,
    sourceTag: node.sourceTag,
    properties: scalarProperties(node.properties),
  };
}

/**
 * Pick the closest name to what was asked for. PMem used difflib's ratio;
 * this ranks the cases that matter in practice: exact (ignoring case), then
 * prefix, then the shortest name containing the query — i.e. the least extra.
 */
export function bestNameMatch<T extends { name: string }>(query: string, candidates: T[]): T | null {
  const q = query.trim().toLowerCase();
  let best: { item: T; rank: number } | null = null;
  for (const item of candidates) {
    const name = item.name.toLowerCase();
    const rank = name === q ? 0 : name.startsWith(q) ? 1 + name.length / 1000 : name.includes(q) ? 2 + name.length / 1000 : 3;
    if (!best || rank < best.rank) best = { item, rank };
  }
  return best && best.rank < 3 ? best.item : null;
}
