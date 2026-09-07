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

export const contractTypeEnum = pgEnum("contract_type", ["MSA", "SOW", "NDA", "RATE_CARD", "PO_TERMS", "OTHER"]);
export const contractStatusEnum = pgEnum("contract_status", [
  "DRAFT",
  "IN_REVIEW",
  "PENDING_SIGNATURE",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "TERMINATED",
]);
export const signatureStatusEnum = pgEnum("signature_status", ["PENDING", "SENT", "SIGNED", "DECLINED", "VOIDED"]);
export const renewalTypeEnum = pgEnum("renewal_type", ["AUTO_RENEW", "MANUAL", "NONE"]);

export const contracts = pgTable(
  "contracts",
  {
    id: primaryId(),
    contractNumber: varchar("contract_number", { length: 24 }).notNull().unique(),
    /** Soft reference into `/suppliers`; no cross-module FK by design. */
    supplierId: text("supplier_id").notNull(),

    title: varchar("title", { length: 240 }).notNull(),
    contractType: contractTypeEnum("contract_type").notNull().default("MSA"),
    status: contractStatusEnum("status").notNull().default("DRAFT"),

    // commercial terms
    totalValue: doublePrecision("total_value"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    paymentTerms: varchar("payment_terms", { length: 30 }).notNull().default("NET30"),

    // lifecycle
    effectiveDate: timestamp("effective_date", { withTimezone: true }),
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    renewalType: renewalTypeEnum("renewal_type").notNull().default("MANUAL"),
    /** Days before expiry at which the renewal alert fires. */
    noticePeriodDays: integer("notice_period_days").notNull().default(90),
    autoRenewTermMonths: integer("auto_renew_term_months"),

    ownerUserId: text("owner_user_id"),
    /** Clause names detected in the document, e.g. ["GDPR","LIMITATION_OF_LIABILITY"]. */
    detectedClauses: jsonb("detected_clauses").$type<string[]>().notNull().default([]),
    /** Mandatory clauses found to be absent — drives the compliance banner. */
    missingClauses: jsonb("missing_clauses").$type<string[]>().notNull().default([]),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),

    notes: text("notes"),
    ...auditTimestamps(),
  },
  (t) => [
    index("contracts_supplier_idx").on(t.supplierId),
    index("contracts_status_idx").on(t.status),
    index("contracts_expiry_idx").on(t.expiryDate),
  ]
);

/** The uploaded paper behind a contract, plus its extraction result. */
export const contractDocuments = pgTable(
  "contract_documents",
  {
    id: primaryId(),
    contractId: text("contract_id").references(() => contracts.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 300 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    s3Bucket: varchar("s3_bucket", { length: 200 }),
    s3Key: varchar("s3_key", { length: 500 }),
    extractedMetadata: jsonb("extracted_metadata"),
    confidence: doublePrecision("confidence"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contract_documents_contract_idx").on(t.contractId)]
);

/** One row per signatory; a contract is SIGNED when every row is. */
export const contractSignatures = pgTable(
  "contract_signatures",
  {
    id: primaryId(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    signerName: varchar("signer_name", { length: 160 }).notNull(),
    signerEmail: varchar("signer_email", { length: 200 }).notNull(),
    isCounterparty: boolean("is_counterparty").notNull().default(false),
    status: signatureStatusEnum("status").notNull().default("PENDING"),
    /** Identifier returned by the e-signature provider (DocuSign/Adobe). */
    externalEnvelopeId: varchar("external_envelope_id", { length: 120 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    ...auditTimestamps(),
  },
  (t) => [index("contract_signatures_contract_idx").on(t.contractId)]
);

export const contractsRelations = relations(contracts, ({ many }) => ({
  documents: many(contractDocuments),
  signatures: many(contractSignatures),
}));

export const contractDocumentsRelations = relations(contractDocuments, ({ one }) => ({
  contract: one(contracts, { fields: [contractDocuments.contractId], references: [contracts.id] }),
}));

export const contractSignaturesRelations = relations(contractSignatures, ({ one }) => ({
  contract: one(contracts, { fields: [contractSignatures.contractId], references: [contracts.id] }),
}));

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type ContractDocument = typeof contractDocuments.$inferSelect;
export type ContractSignature = typeof contractSignatures.$inferSelect;
