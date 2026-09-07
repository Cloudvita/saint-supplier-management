/** Mask a 9-digit tax id for display: **-***6789 (EIN) or ***-**-6789 (SSN). */
export function maskTaxId(taxId?: string | null, type?: string | null): string {
  if (!taxId) return "—";
  const last4 = taxId.slice(-4);
  return type === "SSN" ? `***-**-${last4}` : `**-***${last4}`;
}

/**
 * Drop sensitive columns from a persisted row and attach the masked form.
 *
 * Every read path that leaves the server goes through this, so a raw tax ID
 * cannot reach the browser by someone forgetting to omit a column.
 */
export function withMaskedTaxId<T extends { taxId?: string | null; taxIdType?: string | null }>(
  row: T
): Omit<T, "taxId" | "taxIdType"> & { taxIdMasked: string } {
  const { taxId, taxIdType, ...rest } = row;
  return { ...rest, taxIdMasked: maskTaxId(taxId, taxIdType) };
}
