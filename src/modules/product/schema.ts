import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { primaryId, auditTimestamps } from "@/core/db/columns";

/* ----------------------------- enums ----------------------------- */

/**
 * CANDIDATE: being evaluated or quoted. APPROVED: qualified to supply the
 * part, and the only status that counts towards sole-source exposure.
 * SUSPENDED: qualified once, not to be used for now.
 */
export const partSourceStatusEnum = pgEnum("part_source_status", ["CANDIDATE", "APPROVED", "SUSPENDED"]);

/* -------------------------- part sources ------------------------- */

/**
 * The bridge between the product graph and the supplier master: which
 * supplier can make which part, on what terms.
 *
 * `partId` is a node id in PMem's Neo4j graph and `supplierId` a row in
 * `/suppliers`. Neither is a foreign key — one lives in another database, the
 * other in another module — so both are checked when a link is created.
 * `partName` is a snapshot taken at that point, so lists render without a
 * PMem round trip per row.
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
