/** Format a number as currency for display. */
export function formatMoney(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Percentage variance of `actual` against `expected`, as a positive magnitude. */
export function variancePct(expected: number, actual: number): number {
  if (expected === 0) return actual === 0 ? 0 : 100;
  return Math.abs((actual - expected) / expected) * 100;
}

/** Round to 2dp without floating-point drift in the last cent. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
