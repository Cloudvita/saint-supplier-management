// @ts-check

/**
 * The S.A.I.N.T. procurement ontology: the supply network around SAINT's
 * suppliers, alongside the product ontology in graph-model.js. Both live in
 * the same graph, so a part's suppliers, their sub-tier vendors, where those
 * operate and the risks that reach them are one connected picture.
 *
 * Four node types are SAINT records projected into the graph (never typed-in
 * copies, so the graph cannot contradict the supplier master); the rest are
 * graph data, added from documents and checked against `RELATIONSHIPS`.
 *
 *   Supplier       ← /suppliers   (one node per supplier)
 *   Contract       ← /contracts   (one node per contract)
 *   Category       ← supplier categories
 *   RiskEvent      ← /suppliers risk alerts, and risk events found in documents
 *   SubTierVendor  ← documents only
 *   Location       ← supplier countries, and locations found in documents
 */

/**
 * Node types and the attributes each may carry. A supplier's tax id (EIN) is
 * deliberately absent: it stays in the supplier master and out of the graph
 * and everything sent to an LLM.
 */
export const NODE_TYPES = /** @type {const} */ ({
  Supplier: ["tier", "wri_score", "status", "category", "country", "supplier_code"],
  SubTierVendor: ["service_type", "criticality"],
  Contract: ["contract_type", "expiry_date", "annual_value", "ai_training_allowed", "status", "contract_number"],
  Category: ["domain", "owner"],
  Location: ["country", "region", "is_odc"],
  RiskEvent: ["severity", "event_type", "detected_date", "status"],
});

/** @typedef {keyof typeof NODE_TYPES} NodeType */

/** Allowed (source type, relation, target type) triples. */
export const RELATIONSHIPS = /** @type {const} */ ([
  ["Supplier", "DEPENDS_ON", "SubTierVendor"],
  ["Supplier", "GOVERNED_BY", "Contract"],
  ["Contract", "COVERS_CATEGORY", "Category"],
  ["Supplier", "OPERATES_IN", "Location"],
  ["SubTierVendor", "OPERATES_IN", "Location"],
  ["RiskEvent", "IMPACTS", "Supplier"],
  ["RiskEvent", "IMPACTS", "SubTierVendor"],
  ["RiskEvent", "IMPACTS", "Location"],
]);

/** Types whose nodes come from SAINT's own records; documents may only refer to them. */
export const PROJECTED_TYPES = /** @type {readonly NodeType[]} */ (["Supplier", "Contract"]);

/** The ontology as data, for the schema endpoint and the extraction prompt. */
export function ontologySchema() {
  return {
    node_types: Object.fromEntries(Object.entries(NODE_TYPES).map(([k, v]) => [k, [...v]])),
    allowed_relationships: RELATIONSHIPS.map((r) => [...r]),
  };
}

/**
 * @typedef {{
 *   source_id: string;
 *   source_type: string;
 *   relation: string;
 *   target_id: string;
 *   target_type: string;
 *   properties?: Record<string, unknown>;
 * }} Triple
 *   The shape the LLM extractor emits (the pasted module's GraphTriple):
 *   `source_id` / `target_id` are entity names.
 */

/**
 * Why a triple does not fit the ontology, or null when it does.
 * @param {Triple} t
 * @returns {string | null}
 */
export function tripleError(t) {
  if (!t || typeof t !== "object") return "not an object";
  for (const k of /** @type {const} */ (["source_id", "source_type", "relation", "target_id", "target_type"])) {
    if (typeof t[k] !== "string" || !t[k].trim()) return `${k} is missing`;
  }
  if (!(t.source_type in NODE_TYPES)) return `unknown node type ${t.source_type}`;
  if (!(t.target_type in NODE_TYPES)) return `unknown node type ${t.target_type}`;
  const allowed = RELATIONSHIPS.some(([s, r, o]) => s === t.source_type && r === t.relation && o === t.target_type);
  if (!allowed) return `${t.source_type} -${t.relation}-> ${t.target_type} is not an allowed relationship`;
  return null;
}

/**
 * Keep only the attributes the ontology lists for a type, as scalars.
 * @param {string} type
 * @param {Record<string, unknown> | undefined} properties
 * @returns {Record<string, string | number | boolean>}
 */
export function allowedAttributes(type, properties) {
  const keys = /** @type {readonly string[]} */ (NODE_TYPES[/** @type {NodeType} */ (type)] ?? []);
  /** @type {Record<string, string | number | boolean>} */
  const out = {};
  for (const [k, v] of Object.entries(properties ?? {})) {
    if (keys.includes(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) out[k] = v;
  }
  return out;
}

/**
 * A stable graph key for an entity named in a document: "Location:apac-odc-zone-2".
 * @param {string} type
 * @param {string} name
 */
export function entityKey(type, name) {
  const slug = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return `${type}:${slug}`;
}

/**
 * How a risk reaches an entity: along IMPACTS from the event, then back
 * along a dependency or a location. A supplier is exposed when an event
 * impacts it, a sub-tier vendor it DEPENDS_ON, or a location it (or such a
 * vendor) OPERATES_IN. The pasted module walked the graph ignoring
 * direction, which would also flag a supplier merely for sharing a
 * category or contract with an affected one.
 */
export const RISK_PROPAGATION = /** @type {const} */ ({
  /** Edge types followed from a risk event to what it touches. */
  forward: ["IMPACTS"],
  /** Edge types followed backwards, from the touched entity to who relies on it. */
  backward: ["DEPENDS_ON", "OPERATES_IN"],
});
