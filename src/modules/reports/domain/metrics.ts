/**
 * Metric pipeline primitives.
 *
 * A metric is a named number with a unit and an optional direction of "good",
 * so a dashboard tile, a CSV row and an agent's sentence all describe the same
 * figure the same way.
 */
export type MetricDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "NEUTRAL";

export type Metric = {
  key: string;
  label: string;
  value: number | null;
  unit: "COUNT" | "CURRENCY" | "PERCENT" | "SCORE" | "DAYS";
  direction: MetricDirection;
  /** Short human reading of the number, for chat and tooltips. */
  note?: string;
};

export function metric(
  key: string,
  label: string,
  value: number | null,
  unit: Metric["unit"],
  direction: MetricDirection = "NEUTRAL",
  note?: string
): Metric {
  return { key, label, value, unit, direction, note };
}

/** Share of `part` in `whole`, as a percentage, guarding division by zero. */
export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Number(((part / whole) * 100).toFixed(1));
}

/**
 * Tail spend: the share of total value carried by suppliers outside the top N.
 * A standard procurement measure of fragmentation.
 */
export function tailSpendShare(
  rows: Array<{ totalSpend: number }>,
  topN = 20
): { tailSharePct: number; tailSuppliers: number; totalSpend: number } {
  const sorted = [...rows].sort((a, b) => b.totalSpend - a.totalSpend);
  const total = sorted.reduce((s, r) => s + r.totalSpend, 0);
  const tail = sorted.slice(topN);
  return {
    tailSharePct: share(
      tail.reduce((s, r) => s + r.totalSpend, 0),
      total
    ),
    tailSuppliers: tail.length,
    totalSpend: Number(total.toFixed(2)),
  };
}
