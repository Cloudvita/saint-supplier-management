import { z } from "zod";

export const companyTypes = ["PUBLIC", "PRIVATE"] as const;
export const supplierStatuses = ["DRAFT", "ACTIVE", "ON_HOLD", "BLOCKED"] as const;
export const taxClassifications = [
  "INDIVIDUAL_SOLE_PROPRIETOR",
  "C_CORPORATION",
  "S_CORPORATION",
  "PARTNERSHIP",
  "TRUST_ESTATE",
  "LLC",
  "OTHER",
  "UNKNOWN",
] as const;
export const newsCadences = ["DAILY", "WEEKLY", "MONTHLY"] as const;

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const supplierSchema = z.object({
  legalName: z.string().min(2, "Legal name is required").max(200),
  dbaName: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  companyType: z.enum(companyTypes).default("PRIVATE"),
  tickerSymbol: z.preprocess(
    emptyToUndefined,
    z.string().max(12).regex(/^[A-Za-z.\-]+$/, "Invalid ticker").optional()
  ),
  taxClassification: z.enum(taxClassifications).default("UNKNOWN"),
  taxIdType: z.preprocess(emptyToUndefined, z.enum(["EIN", "SSN"]).optional()),
  taxId: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[^0-9]/g, "") || undefined : v),
    z.string().length(9, "Tax ID must be 9 digits").optional()
  ),
  contactName: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  contactEmail: z.preprocess(emptyToUndefined, z.string().email("Invalid email").optional()),
  contactPhone: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
  website: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  addressLine1: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  addressLine2: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  city: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  state: z.preprocess(emptyToUndefined, z.string().max(60).optional()),
  postalCode: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
  country: z.string().default("USA"),
  category: z.preprocess(emptyToUndefined, z.string().max(120).optional()),
  paymentTerms: z.string().default("NET30"),
  currency: z.string().default("USD"),
  status: z.enum(supplierStatuses).default("DRAFT"),
  diverseSupplier: z.coerce.boolean().default(false),
  newsCadence: z.enum(newsCadences).default("WEEKLY"),
  marketNews: z.preprocess(emptyToUndefined, z.string().max(8000).optional()),
  newsKeywords: z.preprocess(emptyToUndefined, z.string().max(300).optional()),
  alertsEnabled: z.coerce.boolean().default(true),
  procurementManagerEmail: z.preprocess(
    emptyToUndefined,
    z.string().email("Invalid manager email").optional()
  ),
  w9DocumentId: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/** Public shape of a supplier: never carries a raw tax ID. */
export const supplierViewSchema = z.object({
  id: z.string(),
  supplierCode: z.string(),
  legalName: z.string(),
  dbaName: z.string().nullable().optional(),
  companyType: z.string(),
  tickerSymbol: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.string(),
  country: z.string(),
  paymentTerms: z.string(),
  currency: z.string(),
  diverseSupplier: z.boolean(),
  taxIdMasked: z.string(),
  performanceScore: z.number().nullable().optional(),
  onTimeDeliveryPct: z.number().nullable().optional(),
  qualityScore: z.number().nullable().optional(),
});

export type SupplierView = z.infer<typeof supplierViewSchema>;
