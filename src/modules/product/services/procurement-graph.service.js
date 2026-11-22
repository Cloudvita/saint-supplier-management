// @ts-check
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { listAlerts, listSuppliers } from "@/modules/suppliers";
import { listContracts } from "@/modules/contracts";
import { graphEdges, graphNodes, graphSources } from "../schema";
import {
  NODE_TYPES,
  PROJECTED_TYPES,
  RISK_PROPAGATION,
  allowedAttributes,
  entityKey,
  ontologySchema,
  tripleError,
} from "../domain/procurement-ontology.js";
import { appendToSource, syncGraphSource } from "./graph-writer.js";
import { directLinks } from "./graph.repository.js";
import { listPartsForSupplier } from "./sourcing.service";

const log = createLogger("product.procurement-graph");

/**
 * The procurement knowledge graph: the pasted S.A.I.N.T. ontology module,
 * on SAINT's own data and graph tables.
 *
 *   projection  SAINT's suppliers, contracts, categories, countries and open
 *               risk alerts, kept in step with the records (source "SAINT")
 *   network     what documents add — sub-tier vendors, locations, risk
 *               events and their links — checked against the ontology
 *               (source "NETWORK")
 *
 * The LLM side (extracting triples from a document, answering a question
 * from graph context) runs in SAINT's agent service; this module is the
 * ontology, the store and the reasoning over paths.
 *
 * @typedef {import("../domain/procurement-ontology.js").Triple} Triple
 * @typedef {import("../domain/procurement-ontology.js").NodeType} NodeType
 * @typedef {import("./graph.repository.js").NodeRow} NodeRow
 */

export const PROJECTION_SOURCE = { format: "SAINT", name: "SAINT records (supply network)" };
export const NETWORK_SOURCE = { format: "NETWORK", name: "Supply network (from documents)" };

const PROCUREMENT_TYPES = /** @type {NodeType[]} */ (Object.keys(NODE_TYPES));
/** Re-projecting on every request would be wasteful; within this window the last sync stands. */
const PROJECTION_TTL_MS = 60_000;
let projectedAt = 0;

/* ------------------------------ projection ------------------------------- */

/**
 * @template T
 * @param {(page: { limit: number; offset: number }) => Promise<{ items: T[]; total: number }>} fetchPage
 * @returns {Promise<T[]>}
 */
async function allPages(fetchPage) {
  /** @type {T[]} */
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const page = await fetchPage({ limit: 100, offset });
    out.push(...page.items);
    if (page.items.length < 100 || out.length >= page.total) return out;
  }
}

/**
 * Bring the projection of SAINT's records up to date. Nodes keep their ids
 * across syncs, so document links to a supplier survive.
 * @param {{ force?: boolean }} [opts]
 */
export async function syncProcurementProjection(opts = {}) {
  if (!opts.force && Date.now() - projectedAt < PROJECTION_TTL_MS) return;
  const [suppliers, contracts, alerts] = await Promise.all([
    allPages((p) => listSuppliers(p)),
    allPages((p) => listContracts(p)),
    listAlerts({ limit: 100 }),
  ]);

  /** @type {Map<string, import("../domain/graph-document.js").GraphDocumentNode>} */
  const nodes = new Map();
  /** @type {import("../domain/graph-document.js").GraphDocumentEdge[]} */
  const edges = [];
  /**
   * @param {string} key
   * @param {string} name
   * @param {NodeType} type
   * @param {Record<string, unknown>} props
   */
  const node = (key, name, type, props) => {
    if (!nodes.has(key)) nodes.set(key, { key, name, className: type, sourceTag: type, properties: allowedAttributes(type, props) });
    return key;
  };

  /** @type {Map<string, string>} supplier id → its category key */
  const categoryOf = new Map();
  for (const s of suppliers) {
    const sk = node(`supplier:${s.id}`, s.legalName, "Supplier", {
      tier: 1,
      status: s.status,
      category: s.category ?? undefined,
      country: s.country ?? undefined,
      supplier_code: s.supplierCode,
    });
    if (s.category) {
      const ck = node(entityKey("Category", s.category), s.category, "Category", {});
      categoryOf.set(s.id, ck);
    }
    if (s.country) {
      const lk = node(entityKey("Location", s.country), s.country, "Location", { country: s.country });
      edges.push({ from: sk, to: lk, type: "OPERATES_IN", properties: { origin: "supplier country" } });
    }
  }
  const supplierKeys = new Set(suppliers.map((s) => `supplier:${s.id}`));
  for (const c of contracts) {
    const ck = node(`contract:${c.id}`, c.title, "Contract", {
      contract_number: c.contractNumber,
      contract_type: c.contractType,
      expiry_date: c.expiryDate?.slice(0, 10) ?? undefined,
      annual_value: c.totalValue ?? undefined,
      status: c.status,
    });
    if (supplierKeys.has(`supplier:${c.supplierId}`)) edges.push({ from: `supplier:${c.supplierId}`, to: ck, type: "GOVERNED_BY" });
    // SAINT contracts carry no category; the supplier's stands in, and says so.
    const cat = categoryOf.get(c.supplierId);
    if (cat) edges.push({ from: ck, to: cat, type: "COVERS_CATEGORY", properties: { origin: "supplier category" } });
  }
  for (const a of alerts) {
    if (!supplierKeys.has(`supplier:${a.supplierId}`)) continue;
    const rk = node(`risk:${a.id}`, a.title, "RiskEvent", {
      severity: a.severity,
      event_type: a.eventType,
      detected_date: a.createdAt.toISOString().slice(0, 10),
      status: a.status,
    });
    edges.push({ from: rk, to: `supplier:${a.supplierId}`, type: "IMPACTS", properties: { origin: "risk alert" } });
  }

  await syncGraphSource({ ...PROJECTION_SOURCE, nodes: [...nodes.values()], edges }, "system");
  projectedAt = Date.now();
  log.info("procurement projection synced", { suppliers: suppliers.length, contracts: contracts.length, alerts: alerts.length });
}

/* ----------------------------- graph lookups ------------------------------ */

/** @returns {Promise<Array<NodeRow & { externalKey: string | null }>>} */
async function procurementNodes() {
  return db
    .select({
      id: graphNodes.id,
      name: graphNodes.name,
      externalKey: graphNodes.externalKey,
      className: graphNodes.className,
      sourceTag: graphNodes.sourceTag,
      rflpLayer: graphNodes.rflpLayer,
      sourceId: graphNodes.sourceId,
      properties: graphNodes.properties,
    })
    .from(graphNodes)
    .innerJoin(graphSources, eq(graphSources.id, graphNodes.sourceId))
    .where(and(inArray(graphSources.format, [PROJECTION_SOURCE.format, NETWORK_SOURCE.format]), inArray(graphNodes.className, PROCUREMENT_TYPES)));
}

/**
 * Find the node a document's entity name means, among nodes of that type.
 * Exact name, supplier code or contract number first; for SAINT records a
 * name that is a prefix of the real one ("Bluepeak Software" for "Bluepeak
 * Software Corp") also counts, since documents rarely spell out legal names.
 *
 * @param {Array<NodeRow & { externalKey: string | null }>} nodes
 * @param {string} type
 * @param {string} name
 */
function resolve(nodes, type, name) {
  const q = name.trim().toLowerCase();
  const ofType = nodes.filter((n) => n.className === type);
  const exact = ofType.find(
    (n) =>
      n.name.toLowerCase() === q ||
      n.externalKey === entityKey(type, name) ||
      String(n.properties.supplier_code ?? "").toLowerCase() === q ||
      String(n.properties.contract_number ?? "").toLowerCase() === q
  );
  if (exact) return exact;
  if (!PROJECTED_TYPES.includes(/** @type {NodeType} */ (type)) || q.length < 4) return undefined;
  const prefixed = ofType.filter((n) => n.name.toLowerCase().startsWith(q));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/* ------------------------------ ingestion -------------------------------- */

/**
 * Add triples (from a document) to the graph, each checked against the
 * ontology. Suppliers and contracts must be SAINT records; sub-tier vendors,
 * locations, categories and risk events are created when not already there.
 *
 * @param {Triple[]} triples
 * @param {{ document: string; createdBy: string }} meta
 */
export async function addTriples(triples, meta) {
  await syncProcurementProjection();
  const nodes = await procurementNodes();

  /** @type {Array<{ index: number; reason: string }>} */
  const rejections = [];
  /** @type {Map<string, { key: string; name: string; className: string; properties: Record<string, unknown> }>} */
  const toCreate = new Map();
  /** @type {Array<{ fromId?: string; fromKey?: string; toId?: string; toKey?: string; type: string; properties: Record<string, unknown> }>} */
  const edges = [];

  /**
   * @param {string} type
   * @param {string} name
   * @param {Record<string, unknown> | undefined} props
   * @returns {{ id?: string; key?: string } | { error: string }}
   */
  const end = (type, name, props) => {
    const found = resolve(nodes, type, name);
    if (found) return { id: found.id };
    if (PROJECTED_TYPES.includes(/** @type {NodeType} */ (type))) {
      return { error: `${type} "${name}" is not a SAINT ${type === "Supplier" ? "supplier" : "contract"}` };
    }
    const key = entityKey(type, name);
    const pending = toCreate.get(key) ?? { key, name: name.trim(), className: type, properties: {} };
    Object.assign(pending.properties, allowedAttributes(type, props));
    toCreate.set(key, pending);
    return { key };
  };

  triples.forEach((t, index) => {
    const invalid = tripleError(t);
    if (invalid) return void rejections.push({ index, reason: invalid });
    const from = end(t.source_type, t.source_id, t.properties);
    if ("error" in from) return void rejections.push({ index, reason: /** @type {string} */ (from.error) });
    const to = end(t.target_type, t.target_id, t.properties);
    if ("error" in to) return void rejections.push({ index, reason: /** @type {string} */ (to.error) });
    if ((from.id && from.id === to.id) || (from.key && from.key === to.key)) {
      return void rejections.push({ index, reason: "a triple cannot link an entity to itself" });
    }
    /** @type {Record<string, unknown>} */
    const edgeProps = { document: meta.document };
    for (const [k, v] of Object.entries(t.properties ?? {})) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") edgeProps[k] = v;
    }
    edges.push({ fromId: from.id, fromKey: from.key, toId: to.id, toKey: to.key, type: t.relation, properties: edgeProps });
  });

  const result = edges.length
    ? await appendToSource(NETWORK_SOURCE, [...toCreate.values()], edges, meta.createdBy)
    : { edgesAdded: 0 };
  log.info("triples ingested", { document: meta.document, accepted: edges.length, rejected: rejections.length });
  return {
    accepted_triples: edges.length,
    rejected_out_of_schema: rejections.length,
    new_relationships: result.edgesAdded,
    new_entities: toCreate.size,
    rejections,
  };
}

/* ------------------------------ risk trace ------------------------------- */

/**
 * @param {Array<NodeRow & { externalKey: string | null }>} nodes
 * @param {string} supplier  a SAINT supplier id, code or name
 */
function supplierNode(nodes, supplier) {
  return nodes.find((n) => n.className === "Supplier" && n.externalKey === `supplier:${supplier}`) ?? resolve(nodes, "Supplier", supplier);
}

/**
 * Risk events that reach a supplier directly or through what it depends on:
 * an event IMPACTS the supplier, a sub-tier vendor it DEPENDS_ON, or a
 * location it (or such a vendor) OPERATES_IN. Each finding carries the
 * propagation path, and the parts that would lose their only approved
 * source — where the supply network meets the product graph.
 *
 * @param {string} supplier  a SAINT supplier id, code or name
 * @param {number} [maxHops]
 */
export async function traceIndirectRisks(supplier, maxHops = 3) {
  await syncProcurementProjection();
  const nodes = await procurementNodes();
  const start = supplierNode(nodes, supplier);
  if (!start) throw AppError.notFound(`Supplier "${supplier}" in the supply network`);

  /** @type {Map<string, { node: NodeRow; depth: number; parent: string | null; via: string | null }>} */
  const reached = new Map([[start.id, { node: start, depth: 0, parent: null, via: null }]]);
  let frontier = [start.id];
  for (let depth = 1; depth < maxHops && frontier.length; depth++) {
    const links = (await directLinks(frontier, { types: [...RISK_PROPAGATION.backward] })).filter((l) => l.direction === "out");
    /** @type {string[]} */
    const next = [];
    for (const l of links) {
      if (reached.has(l.node.id)) continue;
      reached.set(l.node.id, { node: l.node, depth, parent: l.fromNodeId, via: l.type });
      next.push(l.node.id);
    }
    frontier = next;
  }

  const impacts = (await directLinks([...reached.keys()], { types: [...RISK_PROPAGATION.forward] })).filter(
    (l) => l.direction === "in" && l.node.className === "RiskEvent"
  );
  /** @param {string} id */
  const pathTo = (id) => {
    /** @type {string[]} */
    const names = [];
    for (let at = reached.get(id); at; at = at.parent ? reached.get(at.parent) : undefined) names.unshift(at.node.name);
    return names;
  };

  /** @type {Map<string, { supplier: string; risk_event: string; hop_distance: number; propagation_path: string; details: Record<string, unknown> }>} */
  const findings = new Map();
  for (const l of impacts) {
    const at = /** @type {{ depth: number }} */ (reached.get(l.fromNodeId));
    const hops = at.depth + 1;
    if (hops > maxHops) continue;
    const previous = findings.get(l.node.id);
    if (previous && previous.hop_distance <= hops) continue;
    findings.set(l.node.id, {
      supplier: start.name,
      risk_event: l.node.name,
      hop_distance: hops,
      propagation_path: [...pathTo(l.fromNodeId), l.node.name].join(" -> "),
      details: { ...l.node.properties, impacts: reached.get(l.fromNodeId)?.node.name },
    });
  }

  const saintId = start.externalKey?.startsWith("supplier:") ? start.externalKey.slice("supplier:".length) : null;
  const exposure = saintId ? await listPartsForSupplier(saintId) : null;
  return {
    supplier: start.name,
    indirect_risks: [...findings.values()].sort((a, b) => a.hop_distance - b.hop_distance || a.risk_event.localeCompare(b.risk_event)),
    exposed_parts: exposure
      ? {
          linked: exposure.parts.length,
          sole_source: exposure.parts.filter((p) => p.soleSource).map((p) => p.partName),
        }
      : null,
  };
}

/* ---------------------------- graph context ------------------------------ */

/** Lines of context handed to the LLM; enough for a supplier's neighbourhood, short of a prompt overflow. */
const MAX_CONTEXT_LINES = 300;

/**
 * The procurement graph as relationship lines for Graph-RAG, the pasted
 * module's export_subgraph_context: "(A [Supplier]) -[:DEPENDS_ON]-> (B
 * [SubTierVendor]) | meta={...}". With `focus`, only what lies within two
 * hops of that entity.
 *
 * @param {string} [focus]
 */
export async function graphContext(focus) {
  await syncProcurementProjection();
  const nodes = await procurementNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /** @type {Set<string> | null} */
  let scope = null;
  if (focus) {
    const start =
      supplierNode(nodes, focus) ?? nodes.find((n) => n.name.toLowerCase() === focus.trim().toLowerCase());
    if (!start) return "No matching graph relationships found.";
    scope = new Set([start.id]);
    let frontier = [start.id];
    for (let hop = 0; hop < 2 && frontier.length; hop++) {
      const links = await directLinks(frontier);
      frontier = links.map((l) => l.node.id).filter((id) => byId.has(id) && !scope?.has(id));
      for (const id of frontier) scope.add(id);
    }
  }

  const ids = scope ? [...scope] : nodes.map((n) => n.id);
  if (ids.length === 0) return "No matching graph relationships found.";
  const rows = /** @type {Array<{ from_id: string; to_id: string; type: string; properties: Record<string, unknown> }>} */ (
    /** @type {unknown} */ (
      await db.execute(sql`
        select from_id, to_id, type, properties from ${graphEdges}
        where from_id in ${ids} and to_id in ${ids}
        order by type, from_id
        limit ${MAX_CONTEXT_LINES}
      `)
    )
  );
  const lines = rows
    .filter((r) => byId.has(r.from_id) && byId.has(r.to_id))
    .map((r) => {
      const u = /** @type {NodeRow} */ (byId.get(r.from_id));
      const v = /** @type {NodeRow} */ (byId.get(r.to_id));
      const meta = { ...r.properties };
      delete meta.document;
      return `(${u.name} [${u.className}]) -[:${r.type}]-> (${v.name} [${v.className}]) | meta=${JSON.stringify(meta)}`;
    });
  return lines.length ? lines.join("\n") : "No matching graph relationships found.";
}

/* -------------------------------- schema --------------------------------- */

export async function procurementSchema() {
  await syncProcurementProjection();
  const [counts] = /** @type {Array<{ nodes: number; edges: number }>} */ (
    /** @type {unknown} */ (
      await db.execute(sql`
        select
          (select count(*)::int from ${graphNodes} n join ${graphSources} s on s.id = n.source_id
            where s.format in (${PROJECTION_SOURCE.format}, ${NETWORK_SOURCE.format})) as nodes,
          (select count(*)::int from ${graphEdges} e join ${graphSources} s on s.id = e.source_id
            where s.format in (${PROJECTION_SOURCE.format}, ${NETWORK_SOURCE.format})) as edges
      `)
    )
  );
  return { ontology: ontologySchema(), stats: { nodes: counts?.nodes ?? 0, edges: counts?.edges ?? 0 } };
}

/* ---------------------------------- demo ---------------------------------- */

/**
 * The pasted module's demo network, on SAINT's demo suppliers: two IT
 * suppliers that share a sub-tier host, which a breach then hits. Loaded
 * only when the network is empty and those suppliers exist.
 */
export const DEMO_NETWORK_TRIPLES = /** @type {Triple[]} */ ([
  { source_id: "Bluepeak Software Corp", source_type: "Supplier", relation: "DEPENDS_ON", target_id: "CoreVault Sub-Tier Hosting", target_type: "SubTierVendor", properties: { criticality: "High", service_type: "Managed hosting" } },
  { source_id: "Orchard Data Centers Inc", source_type: "Supplier", relation: "DEPENDS_ON", target_id: "CoreVault Sub-Tier Hosting", target_type: "SubTierVendor", properties: { criticality: "High" } },
  { source_id: "CoreVault Sub-Tier Hosting", source_type: "SubTierVendor", relation: "OPERATES_IN", target_id: "APAC-ODC-Zone-2", target_type: "Location", properties: { region: "APAC", is_odc: true } },
  { source_id: "SEC-2026-884 Sub-Processor Breach", source_type: "RiskEvent", relation: "IMPACTS", target_id: "CoreVault Sub-Tier Hosting", target_type: "SubTierVendor", properties: { severity: "Critical", event_type: "DATA_BREACH", detected_date: "2026-11-15" } },
]);

/** @returns {Promise<boolean>} whether the demo was loaded */
export async function seedDemoNetwork() {
  const [existing] = await db
    .select({ id: graphSources.id })
    .from(graphSources)
    .where(and(eq(graphSources.name, NETWORK_SOURCE.name), eq(graphSources.format, NETWORK_SOURCE.format)));
  if (existing) return false;
  await syncProcurementProjection({ force: true });
  const nodes = await procurementNodes();
  const suppliers = [...new Set(DEMO_NETWORK_TRIPLES.filter((t) => t.source_type === "Supplier").map((t) => t.source_id))];
  if (!suppliers.every((name) => resolve(nodes, "Supplier", name))) return false;
  const result = await addTriples(DEMO_NETWORK_TRIPLES, { document: "S.A.I.N.T. demo network", createdBy: "seed" });
  return result.accepted_triples === DEMO_NETWORK_TRIPLES.length;
}
