import {
  pgTable,
  pgEnum,
  varchar,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { primaryId, auditTimestamps } from "@/core/db/columns";

export const requisitionStatusEnum = pgEnum("requisition_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);
export const poStatusEnum = pgEnum("po_status", ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "RECEIVED",
  "MATCHED",
  "EXCEPTION",
  "APPROVED",
  "PAID",
  "DISPUTED",
]);

/* ----------------------------- budgets --------------------------- */

export const budgets = pgTable(
  "budgets",
  {
    id: primaryId(),
    name: varchar("name", { length: 160 }).notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    costCenter: varchar("cost_center", { length: 40 }).notNull(),
    category: varchar("category", { length: 120 }),
    /** Soft reference into `/user-admin` teams. */
    teamId: text("team_id"),
    amount: doublePrecision("amount").notNull(),
    committed: doublePrecision("committed").notNull().default(0),
    spent: doublePrecision("spent").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    ...auditTimestamps(),
  },
  (t) => [index("budgets_cost_center_idx").on(t.costCenter, t.fiscalYear)]
);

/* --------------------------- requisitions ------------------------ */

export const requisitions = pgTable(
  "requisitions",
  {
    id: primaryId(),
    requisitionNumber: varchar("requisition_number", { length: 24 }).notNull().unique(),
    requesterId: text("requester_id").notNull(),
    supplierId: text("supplier_id"),
    budgetId: text("budget_id").references(() => budgets.id),

    description: text("description").notNull(),
    /** UNSPSC / eCl@ss taxonomy code assigned during classification. */
    commodityCode: varchar("commodity_code", { length: 20 }),
    category: varchar("category", { length: 120 }),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    status: requisitionStatusEnum("status").notNull().default("DRAFT"),

    /** True when an existing catalogue contract covers this buy. */
    onContract: boolean("on_contract").notNull().default(false),
    contractId: text("contract_id"),
    /** Required above the single-source threshold. */
    soleSourceJustification: text("sole_source_justification"),

    approverId: text("approver_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    ...auditTimestamps(),
  },
  (t) => [
    index("requisitions_status_idx").on(t.status),
    index("requisitions_requester_idx").on(t.requesterId),
  ]
);

/* ------------------------- purchase orders ----------------------- */

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: primaryId(),
    poNumber: varchar("po_number", { length: 24 }).notNull().unique(),
    requisitionId: text("requisition_id").references(() => requisitions.id),
    supplierId: text("supplier_id").notNull(),
    contractId: text("contract_id"),
    budgetId: text("budget_id").references(() => budgets.id),

    description: text("description").notNull(),
    category: varchar("category", { length: 120 }),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    paymentTerms: varchar("payment_terms", { length: 30 }).notNull().default("NET30"),
    status: poStatusEnum("status").notNull().default("OPEN"),

    issuedBy: text("issued_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expectedDeliveryDate: timestamp("expected_delivery_date", { withTimezone: true }),
    ...auditTimestamps(),
  },
  (t) => [
    index("purchase_orders_supplier_idx").on(t.supplierId),
    index("purchase_orders_status_idx").on(t.status),
  ]
);

/** Goods receipt — the second leg of the three-way match. */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: primaryId(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    receivedAmount: doublePrecision("received_amount").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    receivedBy: text("received_by"),
    notes: text("notes"),
    onTime: boolean("on_time").notNull().default(true),
  },
  (t) => [index("goods_receipts_po_idx").on(t.purchaseOrderId)]
);

/* ----------------------------- invoices -------------------------- */

export const invoices = pgTable(
  "invoices",
  {
    id: primaryId(),
    invoiceNumber: varchar("invoice_number", { length: 60 }).notNull(),
    purchaseOrderId: text("purchase_order_id").references(() => purchaseOrders.id),
    supplierId: text("supplier_id").notNull(),

    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: invoiceStatusEnum("status").notNull().default("RECEIVED"),

    /** Result of the three-way match: which legs agreed, and by how much. */
    matchResult: jsonb("match_result"),
    exceptionReason: text("exception_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...auditTimestamps(),
  },
  (t) => [
    index("invoices_supplier_idx").on(t.supplierId),
    index("invoices_status_idx").on(t.status),
    index("invoices_po_idx").on(t.purchaseOrderId),
  ]
);

/* --------------------------- relations --------------------------- */

export const budgetsRelations = relations(budgets, ({ many }) => ({
  requisitions: many(requisitions),
  purchaseOrders: many(purchaseOrders),
}));

export const requisitionsRelations = relations(requisitions, ({ one, many }) => ({
  budget: one(budgets, { fields: [requisitions.budgetId], references: [budgets.id] }),
  purchaseOrders: many(purchaseOrders),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  requisition: one(requisitions, {
    fields: [purchaseOrders.requisitionId],
    references: [requisitions.id],
  }),
  budget: one(budgets, { fields: [purchaseOrders.budgetId], references: [budgets.id] }),
  receipts: many(goodsReceipts),
  invoices: many(invoices),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceipts.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [invoices.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
}));

export type Budget = typeof budgets.$inferSelect;
export type Requisition = typeof requisitions.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
