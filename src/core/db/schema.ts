/**
 * The single schema registry.
 *
 * This is the one deliberate place where `core` names every module: Drizzle's
 * relational query API (`db.query.suppliers.findMany({ with: … })`) needs one
 * object describing every table and relation in the database. Think of it as
 * the composition root for persistence, not as core reaching into domains.
 *
 * The dependency is one-directional and cycle-free: a module's `schema.ts`
 * declares tables only and imports nothing from core's client, while a
 * module's *services* import the client. Adding a module means adding it in
 * two places below.
 *
 * The `export *` block is not redundant with the `schema` object: drizzle-kit
 * discovers tables from a file's top-level named exports, so without it
 * `drizzle-kit generate` sees zero tables and emits an empty migration.
 */
export * from "@/modules/auth/schema";
export * from "@/modules/user_admin/schema";
export * from "@/modules/suppliers/schema";
export * from "@/modules/contracts/schema";
export * from "@/modules/spend/schema";

import * as authSchema from "@/modules/auth/schema";
import * as userAdminSchema from "@/modules/user_admin/schema";
import * as suppliersSchema from "@/modules/suppliers/schema";
import * as contractsSchema from "@/modules/contracts/schema";
import * as spendSchema from "@/modules/spend/schema";

export const schema = {
  ...authSchema,
  ...userAdminSchema,
  ...suppliersSchema,
  ...contractsSchema,
  ...spendSchema,
};

export type Schema = typeof schema;
