import { pgTable, pgEnum, varchar, text, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { primaryId, auditTimestamps } from "@/core/db/columns";

export const userStatusEnum = pgEnum("user_status", ["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"]);

/* ------------------------------ teams ---------------------------- */

/**
 * Self-referencing hierarchy: a team's `parentTeamId` points at its parent, so
 * "everything under Indirect Procurement" is a recursive walk rather than a
 * fixed set of levels.
 */
export const teams = pgTable(
  "teams",
  {
    id: primaryId(),
    name: varchar("name", { length: 120 }).notNull().unique(),
    costCenter: varchar("cost_center", { length: 40 }),
    parentTeamId: text("parent_team_id"),
    ...auditTimestamps(),
  },
  (t) => [index("teams_parent_idx").on(t.parentTeamId)]
);

/* ------------------------------ roles ---------------------------- */

export const roles = pgTable("roles", {
  id: primaryId(),
  key: varchar("key", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  /** Permission strings, e.g. ["suppliers:read","spend:*"]. */
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  /** Delegation-of-authority ceiling in USD; null = unlimited. */
  approvalLimit: integer("approval_limit"),
  ...auditTimestamps(),
});

/* ------------------------------ users ---------------------------- */

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    /** Login handle chosen by the administrator. */
    userName: varchar("user_name", { length: 60 }).notNull().unique(),
    firstName: varchar("first_name", { length: 80 }).notNull(),
    lastName: varchar("last_name", { length: 80 }).notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    status: userStatusEnum("status").notNull().default("INVITED"),
    /** Per-user override of the role's DOA ceiling. */
    approvalLimitOverride: integer("approval_limit_override"),
    ...auditTimestamps(),
    createdBy: varchar("created_by", { length: 120 }).default("system"),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_role_idx").on(t.roleId),
    index("users_team_idx").on(t.teamId),
  ]
);

/* --------------------------- relations --------------------------- */

export const rolesRelations = relations(roles, ({ many }) => ({ users: many(users) }));

export const teamsRelations = relations(teams, ({ many, one }) => ({
  users: many(users),
  parent: one(teams, { fields: [teams.parentTeamId], references: [teams.id], relationName: "team_parent" }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Team = typeof teams.$inferSelect;
