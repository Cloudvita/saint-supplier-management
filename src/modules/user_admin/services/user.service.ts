import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { publish } from "@/core/events";
import { createLogger } from "@/core/logger";
import { roles, teams, users } from "../schema";
import { ROLE_DEFINITIONS, findRoleDefinition } from "../domain/permissions";
import type { CreateUserInput, UpdateUserInput, UserView } from "../domain/validation";

const log = createLogger("user_admin");

/**
 * Ensure the role catalogue exists in the database.
 *
 * Roles are code-defined (see `domain/permissions.ts`) and mirrored into a
 * table so users can reference them by FK and an administrator can read them.
 * Idempotent — safe to call on every boot or seed.
 */
export async function syncRoleCatalogue() {
  for (const def of ROLE_DEFINITIONS) {
    await db
      .insert(roles)
      .values({
        key: def.key,
        name: def.name,
        description: def.description,
        permissions: def.permissions,
        approvalLimit: def.approvalLimit,
      })
      .onConflictDoUpdate({
        target: roles.key,
        set: {
          name: def.name,
          description: def.description,
          permissions: def.permissions,
          approvalLimit: def.approvalLimit,
        },
      });
  }
  log.info("role catalogue synced", { roles: ROLE_DEFINITIONS.length });
  return db.select().from(roles).orderBy(asc(roles.name));
}

export async function listRoles() {
  return db.select().from(roles).orderBy(asc(roles.name));
}

async function roleIdFor(key: string): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
  if (row) return row.id;
  // First write on a fresh database — populate the catalogue, then retry once.
  await syncRoleCatalogue();
  const [retry] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
  if (!retry) throw AppError.badRequest(`Unknown role "${key}"`);
  return retry.id;
}

function toView(row: {
  id: string;
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  approvalLimitOverride: number | null;
  role: { key: string; name: string; approvalLimit: number | null } | null;
  team: { name: string } | null;
}): UserView {
  return {
    id: row.id,
    userName: row.userName,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    role: row.role?.key ?? "UNKNOWN",
    roleName: row.role?.name ?? "Unknown",
    teamName: row.team?.name ?? null,
    status: row.status,
    approvalLimit: row.approvalLimitOverride ?? row.role?.approvalLimit ?? null,
  };
}

export async function listUsers(opts: { q?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where = opts.q
    ? or(
        ilike(users.firstName, `%${opts.q}%`),
        ilike(users.lastName, `%${opts.q}%`),
        ilike(users.email, `%${opts.q}%`),
        ilike(users.userName, `%${opts.q}%`)
      )
    : undefined;

  const rows = await db.query.users.findMany({
    where,
    limit,
    orderBy: [asc(users.lastName), asc(users.firstName)],
    with: { role: true, team: true },
  });
  return rows.map(toView);
}

export async function getUser(id: string): Promise<UserView> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, id),
    with: { role: true, team: true },
  });
  if (!row) throw AppError.notFound("User");
  return toView(row);
}

export async function getUserByUserName(userName: string) {
  return db.query.users.findFirst({
    where: eq(users.userName, userName),
    with: { role: true, team: true },
  });
}

/**
 * Resolve a user's effective permission set and approval ceiling.
 *
 * This is the single source of truth `/auth` uses to build a session's
 * `AuthContext`, and `/spend` uses to enforce delegation of authority.
 */
export async function getEffectiveAuthorisation(userId: string) {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { role: true, team: true },
  });
  if (!row) throw AppError.notFound("User");
  if (row.status !== "ACTIVE") {
    throw AppError.forbidden(`User account is ${row.status.toLowerCase()}`);
  }
  const definition = findRoleDefinition(row.role?.key ?? "");
  return {
    userId: row.id,
    displayName: `${row.firstName} ${row.lastName}`,
    role: row.role?.key ?? "UNKNOWN",
    permissions: row.role?.permissions ?? definition?.permissions ?? [],
    approvalLimit: row.approvalLimitOverride ?? row.role?.approvalLimit ?? null,
    teamId: row.teamId,
  };
}

export async function createUser(input: CreateUserInput, createdBy = "system"): Promise<UserView> {
  const roleId = await roleIdFor(input.roleKey);
  try {
    const [row] = await db
      .insert(users)
      .values({
        userName: input.userName,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        roleId,
        teamId: input.teamId,
        approvalLimitOverride: input.approvalLimitOverride,
        status: "INVITED",
        createdBy,
      })
      .returning();

    await publish("user_admin.role_assigned", { userId: row.id, role: input.roleKey });
    log.info("user created", { userId: row.id, role: input.roleKey });
    return getUser(row.id);
  } catch (e) {
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) {
      throw AppError.conflict("That user ID or email is already taken");
    }
    throw e;
  }
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<UserView> {
  const { roleKey, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (roleKey) data.roleId = await roleIdFor(roleKey);

  const [row] = await db.update(users).set(data).where(eq(users.id, id)).returning();
  if (!row) throw AppError.notFound("User");
  if (roleKey) await publish("user_admin.role_assigned", { userId: id, role: roleKey });
  return getUser(id);
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

/* ------------------------------ teams ---------------------------- */

export async function listTeams() {
  return db.select().from(teams).orderBy(asc(teams.name));
}

export async function createTeam(input: { name: string; costCenter?: string; parentTeamId?: string }) {
  const [row] = await db.insert(teams).values(input).returning();
  return row;
}

/**
 * Every team at or below `teamId`, walked recursively.
 * Used by `/reports` and `/spend` to roll figures up a hierarchy.
 */
export async function getTeamSubtree(teamId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM ${teams} WHERE id = ${teamId}
      UNION ALL
      SELECT t.id FROM ${teams} t JOIN subtree s ON t.parent_team_id = s.id
    )
    SELECT id FROM subtree
  `);
  return Array.from(rows).map((r) => r.id);
}

export async function getUserStats() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${users.status} = 'ACTIVE')::int`,
      suspended: sql<number>`count(*) filter (where ${users.status} = 'SUSPENDED')::int`,
    })
    .from(users);
  return row;
}
