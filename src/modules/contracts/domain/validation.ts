import { z } from "zod";

export const contractTypes = ["MSA", "SOW", "NDA", "RATE_CARD", "PO_TERMS", "OTHER"] as const;
export const contractStatuses = [
  "DRAFT",
  "IN_REVIEW",
  "PENDING_SIGNATURE",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "TERMINATED",
] as const;
export const renewalTypes = ["AUTO_RENEW", "MANUAL", "NONE"] as const;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const dateish = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? new Date(v) : v instanceof Date ? v : undefined),
  z.date().optional()
);

export const contractSchema = z.object({
  supplierId: z.string().min(1, "A supplier is required"),
  title: z.string().min(3, "Title is required").max(240),
  contractType: z.enum(contractTypes).default("MSA"),
  status: z.enum(contractStatuses).default("DRAFT"),
  totalValue: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().min(0).optional()
  ),
  currency: z.string().length(3).default("USD"),
  paymentTerms: z.string().max(30).default("NET30"),
  effectiveDate: dateish,
  expiryDate: dateish,
  renewalType: z.enum(renewalTypes).default("MANUAL"),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).default(90),
  autoRenewTermMonths: z.coerce.number().int().min(1).max(120).optional(),
  ownerUserId: z.preprocess(emptyToUndefined, z.string().optional()),
  notes: z.preprocess(emptyToUndefined, z.string().max(4000).optional()),
});

export const signatureRequestSchema = z.object({
  contractId: z.string().min(1),
  signers: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        email: z.string().email(),
        isCounterparty: z.boolean().default(false),
      })
    )
    .min(1, "At least one signer is required"),
});

export type ContractInput = z.infer<typeof contractSchema>;
export type SignatureRequestInput = z.infer<typeof signatureRequestSchema>;

export const contractViewSchema = z.object({
  id: z.string(),
  contractNumber: z.string(),
  supplierId: z.string(),
  title: z.string(),
  contractType: z.string(),
  status: z.string(),
  totalValue: z.number().nullable(),
  currency: z.string(),
  paymentTerms: z.string(),
  effectiveDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  renewalType: z.string(),
  noticePeriodDays: z.number(),
  daysToExpiry: z.number().nullable(),
  missingClauses: z.array(z.string()),
  riskFlags: z.array(z.string()),
});

export type ContractView = z.infer<typeof contractViewSchema>;
