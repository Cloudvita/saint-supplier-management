/**
 * The product graph's vocabulary: edge types and the ontology classes the
 * analyses look for.
 *
 * PMem modelled some of this indirectly in Neo4j — a trace link was its own
 * node with `source` / `target` edges, a file "contained" its items, every
 * item pointed at its class with INSTANCE_OF. Here those are an edge type, a
 * `source_id` column and a `class_name` column. Importers map their format's
 * relationships onto these names, so the analyses stay format-independent.
 */
export const EDGE_TYPES = {
  /** Assembly structure: parent → child (PLMXML hasChildInstance, STEP NAUO, BOM rows). */
  HAS_CHILD: "HAS_CHILD",
  /** A change request or notice → an item it affects. `properties.role`: impacted | problem | solution. */
  CHANGE_AFFECTS: "CHANGE_AFFECTS",
  /** An item → the requirement it satisfies (Seg0Satisfy, FND_TraceLink). */
  SATISFIES: "SATISFIES",
  /** Traceability between items across RFLP layers. */
  TRACES_TO: "TRACES_TO",
  REALIZES: "REALIZES",
  ALLOCATES: "ALLOCATES",
  LINKED_TO: "LINKED_TO",
  /** A document, drawing or model referenced by an item. */
  REFERENCES: "REFERENCES",
} as const;

export type EdgeType = (typeof EDGE_TYPES)[keyof typeof EDGE_TYPES];

/** Edges that say two items are traceable to each other, in either direction. */
export const TRACE_EDGE_TYPES: EdgeType[] = [
  EDGE_TYPES.TRACES_TO,
  EDGE_TYPES.REALIZES,
  EDGE_TYPES.ALLOCATES,
  EDGE_TYPES.LINKED_TO,
];

export const CLASSES = {
  PART: "Part",
  ASSEMBLY: "Assembly",
  PRODUCT_INSTANCE: "ProductInstance",
  REQUIREMENT: "Requirement",
  PROCESS: "Process",
  PROCESS_INSTANCE: "ProcessInstance",
  CHANGE_REQUEST: "ChangeRequest",
  CHANGE_NOTICE: "ChangeNotice",
  DOCUMENT: "Document",
} as const;

/** Classes that are physical items: preferred when a question names "a part". */
export const PART_CLASSES: string[] = [CLASSES.PART, CLASSES.ASSEMBLY, CLASSES.PRODUCT_INSTANCE];

/** Classes a change-impact analysis can start from as a change, not a part. */
export const CHANGE_CLASSES: string[] = [CLASSES.CHANGE_REQUEST, CLASSES.CHANGE_NOTICE];

/** Classes counted as manufacturing process impact. */
export const PROCESS_CLASSES: string[] = [CLASSES.PROCESS, CLASSES.PROCESS_INSTANCE];

/** How far up the assembly tree change impact walks (PMem used 1..4). */
export const MAX_ASSEMBLY_DEPTH = 4;
/** How far a part's neighbourhood is counted for "indirect" connections. */
export const MAX_NEIGHBOURHOOD_DEPTH = 3;
