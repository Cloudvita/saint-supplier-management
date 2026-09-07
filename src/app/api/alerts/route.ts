import { withRoute, ok, intParam, parseJson } from "@/core/http";
import { z } from "zod";
import { requirePermission } from "@/modules/auth";
import { ALERT_STATUSES, listAlerts, setAlertStatus } from "@/modules/suppliers";

export const dynamic = "force-dynamic";

/** GET /api/alerts?status=NEW&limit=20 */
export const GET = withRoute("alerts.list", async (req) => {
  await requirePermission(req, "suppliers:read");
  const url = new URL(req.url);
  return ok({
    alerts: await listAlerts({
      status: url.searchParams.get("status") ?? undefined,
      limit: intParam(url, "limit", 20, 100),
    }),
  });
});

/** PATCH /api/alerts  body { id, status } */
export const PATCH = withRoute("alerts.update", async (req) => {
  await requirePermission(req, "suppliers:write");
  const body = await parseJson(
    req,
    z.object({ id: z.string().min(1), status: z.enum(ALERT_STATUSES) })
  );
  return ok({ alert: await setAlertStatus(body.id, body.status) });
});
