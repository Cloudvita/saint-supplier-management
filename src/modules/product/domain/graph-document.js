// @ts-check

/**
 * What every importer produces and the graph writer consumes.
 *
 * Within a document, nodes are named by their `key` (the id in the source
 * file) and edges refer to those keys; database ids are assigned on write.
 *
 * @typedef {{
 *   key: string;
 *   name: string;
 *   className?: string | null;
 *   sourceTag?: string | null;
 *   rflpLayer?: "R" | "F" | "L" | "P" | null;
 *   properties?: Record<string, unknown>;
 * }} GraphDocumentNode
 *
 * @typedef {{ from: string; to: string; type: string; properties?: Record<string, unknown> }} GraphDocumentEdge
 *
 * @typedef {{ format: string; name: string; nodes: GraphDocumentNode[]; edges: GraphDocumentEdge[] }} GraphDocument
 *
 * An importer's result: the document, and what a person should know about it.
 * @typedef {{ document: GraphDocument; warnings: string[] }} ParsedImport
 */

export {};
