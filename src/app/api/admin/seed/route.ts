import { withRoute, ok } from "@/core/http";
import { AppError } from "@/core/errors";
import { getEnv } from "@/core/config";
import { requireCronSecret } from "@/modules/auth";
import { syncRoleCatalogue } from "@/modules/user_admin";
import { seed } from "@/bootstrap/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/seed   Authorization: Bearer $CRON_SECRET
 *
 * Loads the role catalogue, the demo supply base and an initial administrator
 * into a freshly deployed environment, so a private RDS instance can be
 * populated without opening network access to it. Idempotent.
 *
 * POST /api/admin/seed?only=roles
 *
 * Only brings the role catalogue up to date — new permissions reach existing
 * roles — and touches nothing else: no demo suppliers, no administrator, no
 * demo product graph. The safe way to apply a permission change to a live
 * environment.
 */
export const POST = withRoute("admin.seed", async (req) => {
  if (!getEnv().CRON_SECRET) {
    throw AppError.forbidden("Seeding is disabled because CRON_SECRET is not set");
  }
  requireCronSecret(req);

  const only = new URL(req.url).searchParams.get("only");
  if (only === null) return ok(await seed());
  if (only === "roles") return ok({ roles: (await syncRoleCatalogue()).length, only: "roles" });
  throw AppError.badRequest(`Unknown seed step "${only}"; the only option is only=roles`);
});
