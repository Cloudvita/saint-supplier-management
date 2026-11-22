/**
 * `/product` — the product knowledge graph (parts, assemblies, requirements,
 * processes and the engineering links between them) and which suppliers can
 * make each part.
 *
 * Owns tables: graph_sources, graph_nodes, graph_edges, graph_imports,
 * part_sources. This is
 * PMem's functionality as a SAINT module: the graph lives in SAINT's own
 * Postgres, not Neo4j, and no separate service is involved. Depends on
 * `/suppliers` through its barrel to check the supplier side of a link.
 */
export {
  searchParts,
  getPart,
  getPartLinks,
  analyseChangeImpact,
  findSimilarParts,
} from "./services/product.service";

export {
  writeGraph,
  removeGraphSource,
  listGraphSources,
  seedDemoProductGraph,
} from "./services/graph-writer";

export {
  stageImport,
  getImport,
  listImports,
  commitImport,
  cancelImport,
  supportedFormats,
  MAX_IMPORT_BYTES,
  type ImportView,
  type ImportSummary,
} from "./services/import.service";

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
export type { PartSource, GraphNode, GraphEdge, GraphSource, GraphImport } from "./schema";
export type { GraphDocument } from "./domain/graph-document";

export { EDGE_TYPES, CLASSES, type EdgeType } from "./domain/graph-model";

export { productAgentTools } from "./agent-tools";
