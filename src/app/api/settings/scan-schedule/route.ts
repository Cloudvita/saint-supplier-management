import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { getScanCadence, setScanCadenceForAll } from "@/modules/suppliers";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/scan-schedule
 * Reports the AI Genie scan cadence. `cadence` is non-null only when every
 * supplier currently shares the same one.
 */
export const GET = withRoute("settings.scan-schedule.get", async (req) => {
  await requirePermission(req, "suppliers:read");
  return ok(await getScanCadence());
});

/** PUT /api/settings/scan-schedule  { cadence } — sets it for every supplier. */
export const PUT = withRoute("settings.scan-schedule.set", async (req) => {
  await requirePermission(req, "suppliers:write");
  const { cadence } = await parseJson(req, z.object({ cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]) }));
  return ok(await setScanCadenceForAll(cadence));
});
