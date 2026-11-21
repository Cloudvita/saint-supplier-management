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
    "Engineering change impact for a part, by part name: the parts, assemblies, requirements and " +
    "manufacturing processes a design change would touch, with a 0–100 impact score. Use before " +
    "advising on re-sourcing or re-quoting a part that is changing.",
  permission: "product:read",
  input: z.object({ partName: z.string().min(1).max(200) }),
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
    message: nullableText,
  }),
  handler: async (input) => analyseChangeImpact(input.partName),
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
    "it is qualified. Needs the part id and name from product_search_parts and a supplier id.",
  permission: "product:write",
  mutates: true,
  input: linkSupplierSchema,
  output: partSourceView,
  handler: async (input, ctx) => linkSupplierToPart(input, ctx.userId),
});

export const productAgentTools: AgentToolDefinition[] = [
  searchProductParts,
  productPartLinks,
  productChangeImpact,
  productSimilarParts,
  productPartSuppliers,
  productSupplierParts,
  productLinkSupplier,
] as unknown as AgentToolDefinition[];
