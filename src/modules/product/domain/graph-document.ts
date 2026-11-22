/**
 * What every importer produces and the graph writer consumes.
 *
 * Within a document, nodes are named by their `key` (the id in the source
 * file) and edges refer to those keys; database ids are assigned on write.
 */
export type GraphDocument = {
  format: string;
  name: string;
  nodes: Array<{
    key: string;
    name: string;
    className?: string | null;
    sourceTag?: string | null;
    rflpLayer?: "R" | "F" | "L" | "P" | null;
    properties?: Record<string, unknown>;
  }>;
  edges: Array<{ from: string; to: string; type: string; properties?: Record<string, unknown> }>;
};

export type GraphDocumentNode = GraphDocument["nodes"][number];
export type GraphDocumentEdge = GraphDocument["edges"][number];
