import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { isAlertable, previewNews } from "@/modules/suppliers";

export const dynamic = "force-dynamic";

/**
 * POST /api/news/preview  { companyName, ticker?, keywords?, cadence }
 * Fetches + classifies news for a company that is not saved yet, so the
 * onboarding form can populate the Market News field before submit.
 * Nothing is persisted and no alert emails are sent.
 */
export const POST = withRoute("news.preview", async (req) => {
  await requirePermission(req, "suppliers:read");
  const body = await parseJson(
    req,
    z.object({
      companyName: z.string().trim().min(1, "companyName is required"),
      ticker: z.string().optional(),
      keywords: z.string().optional(),
      cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"),
    })
  );

  const result = await previewNews(body);
  return ok({
    provider: result.provider,
    digest: result.digest,
    riskEvents: result.items.filter(isAlertable).map((i) => ({
      eventType: i.eventType,
      severity: i.severity,
      headline: i.headline,
      url: i.url,
    })),
    count: result.items.length,
  });
});
