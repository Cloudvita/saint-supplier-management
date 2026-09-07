import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { getExecutiveDashboard } from "@/modules/reports";

export const dynamic = "force-dynamic";

/** The cross-module executive dashboard. */
export const GET = withRoute("reports.dashboard", async (req) => {
  await requirePermission(req, "reports:read");
  return ok(await getExecutiveDashboard());
});
