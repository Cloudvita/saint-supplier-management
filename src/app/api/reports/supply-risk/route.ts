import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { getSupplyRiskImpact, listSupplyRiskImpacts } from "@/modules/reports";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/supply-risk?supplierId= — sole-source parts and open POs at
 * stake for every supplier with an open risk alert, worst first, or for one supplier.
 */
export const GET = withRoute("reports.supply-risk", async (req) => {
  await requirePermission(req, "reports:read");
  const supplierId = new URL(req.url).searchParams.get("supplierId");
  return ok({
    impacts: supplierId ? [await getSupplyRiskImpact(supplierId)] : await listSupplyRiskImpacts(),
  });
});
