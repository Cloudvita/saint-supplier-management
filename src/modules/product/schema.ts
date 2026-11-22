import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { primaryId, auditTimestamps, createdAt } from "@/core/db/columns";

/* ----------------------------- enums ----------------------------- */

/**
 * CANDIDATE: being evaluated or quoted. APPROVED: qualified to supply the
 * part, and the only status that counts towards sole-source exposure.
 * SUSPENDED: qualified once, not to be used for now.
 */
export const partSourceStatusEnum = pgEnum("part_source_status", ["CANDIDATE", "APPROVED", "SUSPENDED"]);

/* ------------------------- product graph ------------------------- */

/**
 * The product knowledge graph, in SAINT's own database: what PMem kept in
 * Neo4j. Three tables:
 *
 *   graph_sources — one row per imported file (or the seed), so a file's
 *                   nodes can be listed, replaced or removed together.
 *   graph_nodes   — parts, assemblies, requirements, processes, changes...
 *                   `class_name` is the ontology class (PMem's INSTANCE_OF
 *                   edge); `source_tag` the original element type in the file.
 *   graph_edges   — typed, directed relationships; the vocabulary is in
 *                   `domain/graph-model.ts`.
 *
 * Traversals (where-used, assembly ancestry, change impact) are recursive
 * SQL over graph_edges; see `services/graph.repository.ts`.
 */
export const graphSources = pgTable("graph_sources", {
  id: primaryId(),
  /** STEP, CSV, PLMXML, XMI, SEED ... */
  format: varchar("format", { length: 20 }).notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  nodeCount: integer("node_count").notNull().default(0),
  edgeCount: integer("edge_count").notNull().default(0),
  importedBy: text("imported_by"),
  ...auditTimestamps(),
});

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: primaryId(),
    sourceId: text("source_id").references(() => graphSources.id, { onDelete: "cascade" }),
    /** The node's id inside its source file (a STEP #id, a PLMXML id ...). */
    externalKey: varchar("external_key", { length: 300 }),
    name: varchar("name", { length: 500 }).notNull(),
    className: varchar("class_name", { length: 120 }),
    sourceTag: varchar("source_tag", { length: 120 }),
    /** RFLP layer: R(equirement), F(unctional), L(ogical), P(hysical). */
    rflpLayer: varchar("rflp_layer", { length: 1 }),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    ...auditTimestamps(),
  },
  (t) => [
    uniqueIndex("graph_nodes_source_key_uq").on(t.sourceId, t.externalKey),
    index("graph_nodes_name_lower_idx").on(sql`lower(${t.name})`),
    index("graph_nodes_class_idx").on(t.className),
  ]
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: primaryId(),
    fromId: text("from_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 60 }).notNull(),
    sourceId: text("source_id").references(() => graphSources.id, { onDelete: "cascade" }),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("graph_edges_from_to_type_uq").on(t.fromId, t.toId, t.type),
    index("graph_edges_to_type_idx").on(t.toId, t.type),
  ]
);

/**
 * An uploaded engineering file, parsed and waiting for review.
 *
 * PMem kept import tasks in server memory; on serverless hosting there is no
 * such memory between requests, so the parsed document is staged here.
 * Nothing reaches graph_nodes until the import is committed, and a commit can
 * replace an earlier source in the same transaction (re-importing a file).
 */
export const graphImportStatusEnum = pgEnum("graph_import_status", ["PREVIEW", "COMMITTED", "CANCELLED"]);

export const graphImports = pgTable(
  "graph_imports",
  {
    id: primaryId(),
    format: varchar("format", { length: 20 }).notNull(),
    fileName: varchar("file_name", { length: 300 }).notNull(),
    status: graphImportStatusEnum("status").notNull().default("PREVIEW"),
    /** The parsed GraphDocument; cleared once committed or cancelled. */
    document: jsonb("document").$type<Record<string, unknown> | null>(),
    /** Counts, classes, edge types and sample nodes for the review screen. */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    /** Set on commit: the graph source this import became. */
    sourceId: text("source_id").references(() => graphSources.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    committedBy: text("committed_by"),
    ...auditTimestamps(),
  },
  (t) => [index("graph_imports_status_idx").on(t.status)]
);

export type GraphImport = typeof graphImports.$inferSelect;
export type GraphSource = typeof graphSources.$inferSelect;
export type GraphNode = typeof graphNodes.$inferSelect;
export type GraphEdge = typeof graphEdges.$inferSelect;

/* -------------------------- part sources ------------------------- */

/**
 * The bridge between the product graph and the supplier master: which
 * supplier can make which part, on what terms.
 *
 * `partId` is a `graph_nodes` row and `supplierId` a row in `/suppliers`.
 * The supplier side cannot be a foreign key (another module's table), so it
 * is checked when a link is made. The part side deliberately is not one
 * either: re-importing a file replaces its nodes, and a supplier's approval
 * for a part must survive that. `partName` is the snapshot that keeps such a
 * link readable.
 */
export const partSources = pgTable(
  "part_sources",
  {
    id: primaryId(),
    partId: text("part_id").notNull(),
    partName: varchar("part_name", { length: 300 }).notNull(),
    supplierId: text("supplier_id").notNull(),

    status: partSourceStatusEnum("status").notNull().default("CANDIDATE"),
    supplierPartNumber: varchar("supplier_part_number", { length: 60 }),
    unitPrice: doublePrecision("unit_price"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    leadTimeDays: integer("lead_time_days"),
    notes: text("notes"),

    createdBy: text("created_by"),
    ...auditTimestamps(),
  },
  (t) => [
    uniqueIndex("part_sources_part_supplier_uq").on(t.partId, t.supplierId),
    index("part_sources_supplier_idx").on(t.supplierId),
  ]
);

export type PartSource = typeof partSources.$inferSelect;
export type NewPartSource = typeof partSources.$inferInsert;
