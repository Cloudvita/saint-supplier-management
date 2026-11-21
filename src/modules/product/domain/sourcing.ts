import { z } from "zod";

export const partSourceStatuses = ["CANDIDATE", "APPROVED", "SUSPENDED"] as const;
export type PartSourceStatus = (typeof partSourceStatuses)[number];

/** Commercial terms a buyer records for a supplier ↔ part link. */
const termsShape = {
  status: z.enum(partSourceStatuses).default("CANDIDATE"),
  supplierPartNumber: z.string().trim().max(60).nullish(),
  unitPrice: z.number().nonnegative().nullish(),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  leadTimeDays: z.number().int().nonnegative().max(3650).nullish(),
  notes: z.string().trim().max(2000).nullish(),
};

export const linkSupplierSchema = z.object({
  /** Graph node id, as returned by part search. */
  partId: z.string().trim().min(1),
  /**
   * The part's name. Used to find the node in PMem, which can look a node up
   * by name but not by id alone, and confirmed against `partId` there.
   */
  partName: z.string().trim().min(1).max(300),
  supplierId: z.string().trim().min(1),
  ...termsShape,
});

/** Everything but the identity of the link can change after it is made. */
export const updatePartSourceSchema = z
  .object({
    status: termsShape.status.removeDefault(),
    supplierPartNumber: termsShape.supplierPartNumber,
    unitPrice: termsShape.unitPrice,
    currency: z.string().trim().length(3).toUpperCase(),
    leadTimeDays: termsShape.leadTimeDays,
    notes: termsShape.notes,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type LinkSupplierInput = z.infer<typeof linkSupplierSchema>;
export type UpdatePartSourceInput = z.infer<typeof updatePartSourceSchema>;

/**
 * A part has single-source exposure when exactly one supplier is approved to
 * make it. Candidates do not count: a quote is not a second source.
 */
export function isSoleSource(approvedSupplierCount: number): boolean {
  return approvedSupplierCount === 1;
}
