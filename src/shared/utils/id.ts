import { randomUUID } from "node:crypto";

/** Short, URL-safe, sortable-enough primary key. */
export function createId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

/** Zero-padded document number, e.g. sequenceCode("SUP", 7) -> "SUP-000007". */
export function sequenceCode(prefix: string, n: number, width = 6): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}
