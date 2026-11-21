import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { analyseChangeImpact } from "@/modules/product";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ partName: z.string().trim().min(1).max(200) });

/** POST /api/product/change-impact { partName } — what a design change to a part touches */
export const POST = withRoute("product.change-impact", async (req) => {
  await requirePermission(req, "product:read");
  const { partName } = await parseJson(req, bodySchema);
  return ok(await analyseChangeImpact(partName));
});
