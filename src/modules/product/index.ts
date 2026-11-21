/**
 * `/product` — the product knowledge graph: parts, assemblies and the
 * engineering links between them, served by the PMem service over Neo4j —
 * and which suppliers can make each part.
 *
 * Owns tables: part_sources. Graph reads go through PMem's HTTP API; imports
 * of CAD/PLM files happen in PMem itself. Depends on `/suppliers` through its
 * barrel to check and describe the supplier side of a link.
 */
export {
  searchParts,
  getPartLinks,
  analyseChangeImpact,
  findSimilarParts,
} from "./services/product.service";

export {
  linkSupplierToPart,
  updatePartSource,
  removePartSource,
  listSourcesForPart,
  listPartsForSupplier,
  confirmPart,
  getPartSourceStatus,
  type PartSourceView,
  type SupplierSummary,
} from "./services/sourcing.service";

export { pmemHealth } from "./services/pmem-client";

export {
  linkSupplierSchema,
  updatePartSourceSchema,
  partSourceStatuses,
  isSoleSource,
  type LinkSupplierInput,
  type UpdatePartSourceInput,
  type PartSourceStatus,
} from "./domain/sourcing";

export type { ProductNode, ProductLink } from "./domain/graph";
export type { ChangeImpact, SimilarParts } from "./domain/impact";
export type { PartSource } from "./schema";

export { productAgentTools } from "./agent-tools";
