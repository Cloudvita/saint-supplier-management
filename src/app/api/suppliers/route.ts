import { withRoute, ok, created, intParam, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { createSupplier, listSuppliers, supplierSchema } from "@/modules/suppliers";

export const dynamic = "force-dynamic";

/** GET /api/suppliers?limit=10&q=&companyType= — most recent first */
export const GET = withRoute("suppliers.list", async (req) => {
  const ctx = await requirePermission(req, "suppliers:read");
  const url = new URL(req.url);
  const companyType = url.searchParams.get("companyType");

  const page = await listSuppliers({
    q: url.searchParams.get("q")?.trim() || undefined,
    companyType: companyType === "PUBLIC" || companyType === "PRIVATE" ? companyType : undefined,
    limit: intParam(url, "limit", 10, 100),
  });

  // Response shape is preserved for existing clients.
  return ok({ suppliers: page.items, total: page.total, limit: page.limit, actor: ctx.userId });
});

/** POST /api/suppliers — manual supplier entry */
export const POST = withRoute("suppliers.create", async (req) => {
  const ctx = await requirePermission(req, "suppliers:write");
  const input = await parseJson(req, supplierSchema);
  return created({ supplier: await createSupplier(input, ctx.userId) });
});
