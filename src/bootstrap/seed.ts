import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { getEnv } from "@/core/config";
import { createLogger } from "@/core/logger";
import { suppliers } from "@/modules/suppliers/schema";
import { buildDemoRows } from "@/modules/suppliers/domain/seed-data";
import { createUser, syncRoleCatalogue, createTeam, listUsers, updateUser } from "@/modules/user_admin";
import { setPassword } from "@/modules/auth";
import { seedDemoProductGraph } from "@/modules/product";

const log = createLogger("seed");

/**
 * Bring a fresh environment up to a usable state.
 *
 * Idempotent throughout: the role catalogue upserts, and the supplier, user and
 * product-graph seeds no-op when data already exists, so this is safe to run on
 * every deploy.
 */
export async function seed() {
  // 1. Roles are code-defined; mirror them into the database first because
  //    users reference them by foreign key.
  const roles = await syncRoleCatalogue();
  log.info("roles ready", { count: roles.length });

  // 2. Demo supply base.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(suppliers);
  let seededSuppliers = 0;
  if (count > 0) {
    log.info("supplier seed skipped", { existing: count });
  } else {
    const rows = buildDemoRows(
      getEnv().DEFAULT_PROCUREMENT_MANAGER_EMAIL ?? "procurement.manager@example.com"
    );
    await db.insert(suppliers).values(rows);
    seededSuppliers = rows.length;
    log.info("suppliers seeded", { count: seededSuppliers });
  }

  // 3. An administrator to sign in with.
  const existingUsers = await listUsers({ limit: 1 });
  let seededAdmin = false;
  if (existingUsers.length === 0) {
    const team = await createTeam({ name: "Procurement", costCenter: "CC-1000" });
    const admin = await createUser(
      {
        userName: "admin",
        firstName: "Platform",
        lastName: "Administrator",
        email: getEnv().DEFAULT_PROCUREMENT_MANAGER_EMAIL ?? "admin@example.com",
        roleKey: "SUPER_USER",
        teamId: team.id,
      },
      "seed"
    );
    // An initial password that must be changed on first sign-in. Override with
    // SEED_ADMIN_PASSWORD; the default is only viable on a throwaway database.
    const initial = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMeNow!2026";
    await setPassword(admin.id, initial, true);

    // `createUser` provisions accounts as INVITED, and sign-in requires an
    // ACTIVE one. The seeded administrator is the bootstrap account — there is
    // nobody else who could activate it, so it activates itself.
    await updateUser(admin.id, { status: "ACTIVE" });
    seededAdmin = true;
    log.warn("seeded administrator — change this password immediately", { userName: "admin" });
  }

  // 4. A demo product graph, only into an empty graph.
  const seededProductGraph = await seedDemoProductGraph();
  log.info(seededProductGraph ? "demo product graph seeded" : "product graph seed skipped");

  return { seededSuppliers, seededAdmin, seededProductGraph, roles: roles.length };
}

// Allow `npm run db:seed` to execute this file directly.
if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
