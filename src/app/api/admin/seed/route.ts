import { withRoute, ok } from "@/core/http";
import { AppError } from "@/core/errors";
import { getEnv } from "@/core/config";
import { requireCronSecret } from "@/modules/auth";
import { seed } from "@/bootstrap/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/seed   Authorization: Bearer $CRON_SECRET
 *
 * Loads the role catalogue, the demo supply base and an initial administrator
 * into a freshly deployed environment, so a private RDS instance can be
 * populated without opening network access to it. Idempotent.
 */
export const POST = withRoute("admin.seed", async (req) => {
  if (!getEnv().CRON_SECRET) {
    throw AppError.forbidden("Seeding is disabled because CRON_SECRET is not set");
  }
  requireCronSecret(req);
  return ok(await seed());
});
