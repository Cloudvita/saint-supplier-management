import { z } from "zod";

export const requisitionStatuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CONVERTED"] as const;
export const poStatuses = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"] as const;
export const invoiceStatuses = ["RECEIVED", "MATCHED", "EXCEPTION", "APPROVED", "PAID", "DISPUTED"] as const;

const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional()
);

/**
 * The part a buy is for, from the product graph. `partName` is only needed
 * for a part no supplier is linked to yet — see `confirmPart` in `/product`.
 */
const partFields = {
  partId: optionalString,
  partName: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().max(300).optional()
  ),
};

export const requisitionSchema = z.object({
  description: z.string().min(5, "Describe what is being bought").max(2000),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  currency: z.string().length(3).default("USD"),
  supplierId: optionalString,
  budgetId: optionalString,
  category: optionalString,
  competitiveBids: z.coerce.number().int().min(0).default(0),
  soleSourceJustification: optionalString,
  ...partFields,
});

export const purchaseOrderSchema = z.object({
  requisitionId: optionalString,
  supplierId: z.string().min(1, "A supplier is required"),
  budgetId: optionalString,
  contractId: optionalString,
  description: z.string().min(5).max(2000),
  category: optionalString,
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default("USD"),
  paymentTerms: z.string().max(30).default("NET30"),
  expectedDeliveryDate: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? new Date(v) : v instanceof Date ? v : undefined),
    z.date().optional()
  ),
  competitiveBids: z.coerce.number().int().min(0).default(0),
  soleSourceJustification: optionalString,
  ...partFields,
});

export const invoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(60),
  purchaseOrderId: optionalString,
  supplierId: z.string().min(1),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default("USD"),
  invoiceDate: z.preprocess(
    (v) => (typeof v === "string" ? new Date(v) : v),
    z.date()
  ),
  dueDate: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? new Date(v) : v instanceof Date ? v : undefined),
    z.date().optional()
  ),
});

export const budgetSchema = z.object({
  name: z.string().min(2).max(160),
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  costCenter: z.string().min(1).max(40),
  category: optionalString,
  teamId: optionalString,
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default("USD"),
});

export const goodsReceiptSchema = z.object({
  purchaseOrderId: z.string().min(1),
  receivedAmount: z.coerce.number().min(0),
  onTime: z.boolean().default(true),
  notes: optionalString,
});

export type RequisitionInput = z.infer<typeof requisitionSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const policyDecisionSchema = z.object({
  approved: z.boolean(),
  violations: z.array(z.object({ control: z.string(), message: z.string(), severity: z.string() })),
  warnings: z.array(z.object({ control: z.string(), message: z.string(), severity: z.string() })),
});
