import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { listGraphSources } from "@/modules/product";

export const dynamic = "force-dynamic";

/** GET /api/product/graph-sources — every imported file (and the seed) in the product graph */
export const GET = withRoute("product.graph-sources.list", async (req) => {
  await requirePermission(req, "product:read");
  return ok({ sources: await listGraphSources() });
});
