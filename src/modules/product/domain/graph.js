// @ts-check

/**
 * The product view of graph nodes, and the pure helpers the analyses share.
 *
 * @typedef {{
 *   id: string;
 *   name: string;
 *   labels: string[];
 *   className: string | null;
 *   sourceTag: string | null;
 *   properties: Record<string, string | number | boolean>;
 * }} ProductNode
 *   `labels` is the node's ontology class as a one-element list (empty when
 *   unclassified); `sourceTag` the element type in the file it came from.
 *
 * @typedef {{ relation: string; direction: "out" | "in"; node: ProductNode }} ProductLink
 *   `direction` is `out` when the part points at the other node, `in` when it
 *   is pointed at.
 */

/**
 * Imported nodes can carry raw text, geometry references and the like. Only
 * short scalar properties are useful to a buyer or a model, and the rest
 * would blow the agent's context for no gain.
 */
const MAX_PROPERTIES = 25;
const MAX_STRING_LENGTH = 300;
const SKIPPED_KEYS = /embedding|vector|body_?text|raw/i;

/**
 * @param {Record<string, unknown>} properties
 * @returns {ProductNode["properties"]}
 */
export function scalarProperties(properties) {
  /** @type {ProductNode["properties"]} */
  const out = {};
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

/**
 * @param {{ id: string; name: string; className: string | null; sourceTag: string | null; properties: Record<string, unknown> }} node
 * @returns {ProductNode}
 */
export function toProductNode(node) {
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
 * Pick the closest match to what was asked for. PMem used difflib's ratio;
 * this ranks the cases that matter in practice: the part number exactly,
 * then the name exactly (ignoring case), then a name prefix, then the
 * shortest name containing the query — i.e. the least extra.
 *
 * @template {{ name: string; externalKey?: string | null }} T
 * @param {string} query
 * @param {T[]} candidates
 * @returns {T | null}
 */
export function bestNameMatch(query, candidates) {
  const q = query.trim().toLowerCase();
  /** @type {{ item: T; rank: number } | null} */
  let best = null;
  for (const item of candidates) {
    const name = item.name.toLowerCase();
    const key = (item.externalKey ?? "").toLowerCase();
    const rank =
      key === q ? 0 : name === q ? 0.5 : name.startsWith(q) ? 1 + name.length / 1000 : name.includes(q) ? 2 + name.length / 1000 : 3;
    if (!best || rank < best.rank) best = { item, rank };
  }
  return best && best.rank < 3 ? best.item : null;
}
