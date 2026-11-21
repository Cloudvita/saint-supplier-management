/**
 * `/product` — the product knowledge graph: parts, assemblies and the
 * engineering links between them, served by the PMem service over Neo4j.
 *
 * Owns no tables yet. Reads go through PMem's HTTP API; imports of CAD/PLM
 * files happen in PMem itself. Linking graph parts to suppliers and purchase
 * orders is the next step and will add this module's first table.
 */
export {
  searchParts,
  getPartLinks,
  analyseChangeImpact,
  findSimilarParts,
} from "./services/product.service";

export { pmemHealth } from "./services/pmem-client";

export type { ProductNode, ProductLink } from "./domain/graph";
export type { ChangeImpact, SimilarParts } from "./domain/impact";

export { productAgentTools } from "./agent-tools";
