import { timestamp, text } from "drizzle-orm/pg-core";
import { createId } from "@/shared/utils/id";

/**
 * Column builders every module reuses, so primary keys and audit timestamps
 * are declared identically in all seven schemas.
 */
export const primaryId = () => text("id").primaryKey().$defaultFn(createId);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** `created_at` + `updated_at`, spread into any table definition. */
export const auditTimestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
