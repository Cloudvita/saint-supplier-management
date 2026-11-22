import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";
import {
  analyseChangeImpact,
  findSimilarParts,
  getPartLinks,
  searchParts,
} from "./services/product.service";
import {
  linkSupplierToPart,
  listPartsForSupplier,
  listSourcesForPart,
} from "./services/sourcing.service";
import { linkSupplierSchema, partSourceStatuses } from "./domain/sourcing";
import { addTriples, graphContext, traceIndirectRisks } from "./services/procurement-graph.service";

/**
 * Product knowledge graph capabilities for the AI layer.
 *
 * These let an agent answer the engineering half of a sourcing question —
 * "which assemblies use this bearing?", "what does a change to the rotor
 * shaft touch?" — next to the supplier and spend tools it already has.
 */

const productNode = z.object({
  id: z.string(),
  name: z.string(),
  labels: z.array(z.string()),
  className: z.string().nullable(),
  sourceTag: z.string().nullable(),
  properties: z.record(z.union([z.string(), z.number(), z.boolean()])),
});

const nullableText = z.string().nullable();

export const searchProductParts = defineAgentTool({
  name: "product_search_parts",
  module: "product",
  description:
    "Search the product knowledge graph (parts, assemblies, requirements, documents imported from " +
    "CAD/PLM files) by name, label or id. Use this first whenever a question names a part or " +
    "assembly, to resolve it to a graph node id before calling product_part_links.",
  permission: "product:read",
  input: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.object({ parts: z.array(productNode), total: z.number() }),
  handler: async (input) => searchParts({ q: input.query, limit: input.limit }),
});

export const productPartLinks = defineAgentTool({
  name: "product_part_links",
  module: "product",
  description:
    "Everything a part is directly connected to in the product graph — the assemblies it is used " +
    "in, requirements, manufacturing processes, documents — with the relationship type and " +
    "direction. Answers 'where is this part used?'. Takes an id from product_search_parts.",
  permission: "product:read",
  input: z.object({
    partId: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  output: z.object({
    part: productNode,
    links: z.array(
      z.object({ relation: z.string(), direction: z.enum(["out", "in"]), node: productNode })
    ),
    indirectCount: z.number(),
  }),
  handler: async (input) => getPartLinks(input.partId, input.limit),
});

export const productChangeImpact = defineAgentTool({
  name: "product_change_impact",
  module: "product",
  description:
    "Engineering change impact, from a part name or a change request / notice name: the parts, " +
    "assemblies, requirements, manufacturing processes and trace links a design change would touch, " +
    "with a 0–100 impact score. Use before advising on re-sourcing or re-quoting a part that is changing.",
  permission: "product:read",
  input: z
    .object({
      partName: z.string().min(1).max(200).optional().describe("Analyse a change to this part"),
      changeName: z.string().min(1).max(200).optional().describe("Or: analyse this change request / notice"),
    })
    .refine((v) => Boolean(v.partName) !== Boolean(v.changeName), { message: "Give exactly one of partName or changeName" }),
  output: z.object({
    changeEntity: z
      .object({ name: z.string(), sourceTag: nullableText, revision: nullableText, id: nullableText })
      .nullable(),
    impactScore: z.number(),
    impactedParts: z.array(
      z.object({ name: z.string(), sourceTag: nullableText, relation: nullableText, className: nullableText })
    ),
    affectedAssemblies: z.array(
      z.object({ assembly: z.string(), depth: z.number(), viaPart: nullableText })
    ),
    affectedRequirements: z.array(
      z.object({ name: z.string(), catalogueId: nullableText, linkedPart: nullableText })
    ),
    affectedProcesses: z.array(
      z.object({ name: z.string(), linkType: nullableText, sourceTag: nullableText, viaPart: nullableText })
    ),
    traceLinks: z.array(
      z.object({ name: z.string(), linkType: z.string(), sourceTag: nullableText, viaPart: nullableText })
    ),
    message: nullableText,
  }),
  handler: async (input) =>
    input.changeName
      ? analyseChangeImpact(input.changeName, { asChange: true })
      : analyseChangeImpact(input.partName as string),
});

export const productSimilarParts = defineAgentTool({
  name: "product_similar_parts",
  module: "product",
  description:
    "Parts in the graph that resemble a given part (by source, functional layer, shared assembly " +
    "and name), scored 0–100. Use for substitution ideas or to spot parts that could be sourced " +
    "together.",
  permission: "product:read",
  input: z.object({
    partName: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  output: z.object({
    sourcePart: z.object({ name: z.string(), sourceTag: nullableText, layer: nullableText }).nullable(),
    similarParts: z.array(
      z.object({
        name: z.string(),
        sourceTag: nullableText,
        layer: nullableText,
        score: z.number(),
        sharedAssembly: z.boolean(),
      })
    ),
    message: nullableText,
  }),
  handler: async (input) => findSimilarParts(input.partName, input.limit),
});

/* ------------------------- supplier ↔ part links ------------------------- */

const partSourceView = z.object({
  id: z.string(),
  partId: z.string(),
  partName: z.string(),
  supplierId: z.string(),
  status: z.enum(partSourceStatuses),
  supplierPartNumber: nullableText,
  unitPrice: z.number().nullable(),
  currency: z.string(),
  leadTimeDays: z.number().nullable(),
  notes: nullableText,
  updatedAt: z.string(),
});

const supplierSummary = z.object({
  id: z.string(),
  supplierCode: z.string(),
  legalName: z.string(),
  status: z.string(),
  openRiskAlerts: z.number(),
});

export const productPartSuppliers = defineAgentTool({
  name: "product_part_suppliers",
  module: "product",
  description:
    "Which suppliers can make a part: approved, candidate and suspended sources with price, lead " +
    "time, supplier status and open risk alerts, plus whether the part is single-sourced. Takes a " +
    "part id from product_search_parts.",
  permission: "product:read",
  input: z.object({ partId: z.string().min(1) }),
  output: z.object({
    partId: z.string(),
    partName: z.string().nullable(),
    approvedCount: z.number(),
    soleSource: z.boolean(),
    sources: z.array(partSourceView.extend({ supplier: supplierSummary.nullable() })),
  }),
  handler: async (input) => listSourcesForPart(input.partId),
});

export const productSupplierParts = defineAgentTool({
  name: "product_supplier_parts",
  module: "product",
  description:
    "Every part a supplier is linked to, and for each one how many approved sources it has. Parts " +
    "flagged soleSource have this supplier as their only approved source — they are what is at risk " +
    "if the supplier fails, is acquired or is blocked. Resolve the supplier with suppliers_search first.",
  permission: "product:read",
  input: z.object({ supplierId: z.string().min(1) }),
  output: z.object({
    supplier: supplierSummary,
    parts: z.array(partSourceView.extend({ approvedSourceCount: z.number(), soleSource: z.boolean() })),
    soleSourceCount: z.number(),
  }),
  handler: async (input) => listPartsForSupplier(input.supplierId),
});

export const productLinkSupplier = defineAgentTool({
  name: "product_link_supplier",
  module: "product",
  description:
    "Record that a supplier can make a part, with optional price, lead time and supplier part number. " +
    "Creates the link as CANDIDATE unless told otherwise; only approve a source when the user says " +
    "it is qualified. Needs a part id from product_search_parts and a supplier id.",
  permission: "product:write",
  mutates: true,
  input: linkSupplierSchema,
  output: partSourceView,
  handler: async (input, ctx) => linkSupplierToPart(input, ctx.userId),
});

/* ---------------------- procurement knowledge graph ---------------------- */

const ontologyTriple = z.object({
  source_id: z.string().min(1).max(200),
  source_type: z.string().min(1).max(40),
  relation: z.string().min(1).max(40),
  target_id: z.string().min(1).max(200),
  target_type: z.string().min(1).max(40),
  properties: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const networkTraceRisk = defineAgentTool({
  name: "network_trace_risk",
  module: "product",
  description:
    "Indirect supply-chain risk for a supplier: risk events (breaches, outages, disputes) that reach it directly " +
    "or through a sub-tier vendor it depends on or a location it operates in, each with the propagation path " +
    "(A -> B -> C) and hop distance, plus the parts it is sole source for. Takes a supplier id, code or name.",
  permission: "product:read",
  input: z.object({
    supplier: z.string().min(1).max(200),
    maxHops: z.number().int().min(1).max(6).default(3),
  }),
  output: z.object({
    supplier: z.string(),
    indirect_risks: z.array(
      z.object({
        supplier: z.string(),
        risk_event: z.string(),
        hop_distance: z.number(),
        propagation_path: z.string(),
        details: z.record(z.unknown()),
      })
    ),
    exposed_parts: z.object({ linked: z.number(), sole_source: z.array(z.string()) }).nullable(),
  }),
  handler: async (input) => traceIndirectRisks(input.supplier, input.maxHops),
});

export const networkContext = defineAgentTool({
  name: "network_context",
  module: "product",
  description:
    "The supply-network knowledge graph as relationship lines — suppliers, sub-tier vendors, contracts, " +
    "categories, locations, risk events — optionally limited to two hops around one entity. Use to ground " +
    "answers about dependencies; answer only from what it returns.",
  permission: "product:read",
  input: z.object({ focus: z.string().min(1).max(200).optional() }),
  output: z.object({ context: z.string() }),
  handler: async (input) => ({ context: await graphContext(input.focus) }),
});

export const networkAddTriples = defineAgentTool({
  name: "network_add_triples",
  module: "product",
  description:
    "Add supply-network facts stated in a document as ontology triples (e.g. Supplier DEPENDS_ON SubTierVendor, " +
    "SubTierVendor OPERATES_IN Location, RiskEvent IMPACTS SubTierVendor). Triples outside the ontology, or naming " +
    "a supplier or contract that is not in SAINT, are rejected with a reason. Only add what the user's document states.",
  permission: "product:write",
  mutates: true,
  input: z.object({
    document: z.string().min(1).max(200),
    triples: z.array(ontologyTriple).min(1).max(100),
  }),
  output: z.object({
    accepted_triples: z.number(),
    rejected_out_of_schema: z.number(),
    new_relationships: z.number(),
    new_entities: z.number(),
    rejections: z.array(z.object({ index: z.number(), reason: z.string() })),
  }),
  handler: async (input, ctx) => addTriples(input.triples, { document: input.document, createdBy: ctx.userId }),
});

export const productAgentTools: AgentToolDefinition[] = [
  searchProductParts,
  productPartLinks,
  productChangeImpact,
  productSimilarParts,
  productPartSuppliers,
  productSupplierParts,
  productLinkSupplier,
  networkTraceRisk,
  networkContext,
  networkAddTriples,
] as unknown as AgentToolDefinition[];
