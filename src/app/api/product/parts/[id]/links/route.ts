import { withRoute, ok, intParam } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { getPartLinks } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/product/parts/:id/links?limit=50 — what a part is connected to.
 * `id` is the graph node id from the search, URL-encoded (it contains colons).
 */
export const GET = withRoute<Ctx>("product.parts.links", async (req, { params }) => {
  await requirePermission(req, "product:read");
  const { id } = await params;
  const url = new URL(req.url);
  return ok(await getPartLinks(decodeURIComponent(id), intParam(url, "limit", 50, 100)));
});
