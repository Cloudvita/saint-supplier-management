import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { AppError } from "@/core/errors";
import { requireCronSecret, requirePermission } from "@/modules/auth";
import {
  refreshAllSuppliers,
  refreshDueSuppliers,
  refreshSupplierNews,
} from "@/modules/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  supplierId: z.string().optional(),
  scanAll: z.boolean().optional(),
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
});

/**
 * POST /api/news/refresh
 *   { supplierId }        -> refresh one supplier (UI)
 *   { scanAll: true }     -> "AI Genie" scan of every supplier (UI)
 *   { cadence: "WEEKLY" } -> scheduled batch; authorised with CRON_SECRET
 */
export const POST = withRoute("news.refresh", async (req) => {
  const body = await parseJson(req, bodySchema);

  if (body.supplierId) {
    await requirePermission(req, "suppliers:write");
    return ok(await refreshSupplierNews(body.supplierId));
  }

  if (body.scanAll) {
    await requirePermission(req, "suppliers:write");
    const results = await refreshAllSuppliers();
    const flagged = results.filter((r) => r.alertsCreated > 0);
    return ok({
      suppliersScanned: results.length,
      alertsCreated: results.reduce((s, r) => s + r.alertsCreated, 0),
      flaggedSuppliers: flagged.map((r) => ({ supplierId: r.supplierId, companyName: r.companyName })),
    });
  }

  if (body.cadence) {
    requireCronSecret(req);
    const results = await refreshDueSuppliers(body.cadence);
    return ok({
      cadence: body.cadence,
      suppliersProcessed: results.length,
      alertsCreated: results.reduce((s, r) => s + r.alertsCreated, 0),
    });
  }

  throw AppError.badRequest("Provide supplierId, scanAll or cadence");
});
