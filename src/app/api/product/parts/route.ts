import { withRoute, ok, intParam } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import { searchParts } from "@/modules/product";

export const dynamic = "force-dynamic";

/** GET /api/product/parts?q=bearing&limit=10 — search the product knowledge graph */
export const GET = withRoute("product.parts.search", async (req) => {
  await requirePermission(req, "product:read");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) throw AppError.badRequest("Query parameter q is required");

  return ok(await searchParts({ q, limit: intParam(url, "limit", 10, 50) }));
});
