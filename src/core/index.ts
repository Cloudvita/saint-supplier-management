/**
 * `@/core` — cross-cutting infrastructure shared by every module.
 *
 * Rule: core must never import from `@/modules/*` (the sole, documented
 * exception is `core/db/schema.ts`, which composes the Drizzle schema
 * registry). Enforced by `npm run check:boundaries`.
 */
export * from "./config";
export * from "./errors";
export * from "./logger";
export * from "./http";
export * from "./events";
export * from "./agent";
