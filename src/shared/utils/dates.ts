export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from now until `date`; negative when already past. */
export function daysUntil(date: Date | string, from: Date = new Date()): number {
  const target = typeof date === "string" ? new Date(date) : date;
  return Math.ceil((target.getTime() - from.getTime()) / DAY_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** ISO date only, e.g. 2026-09-06. */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Window start for a scan cadence. */
export function cadenceWindowStart(
  cadence: "DAILY" | "WEEKLY" | "MONTHLY",
  from: Date = new Date()
): Date {
  const days = cadence === "DAILY" ? 1 : cadence === "WEEKLY" ? 7 : 30;
  return addDays(from, -days);
}
