import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { listPartsForSupplier } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/product/suppliers/:id/parts — parts this supplier makes, with sole-source exposure */
export const GET = withRoute<Ctx>("product.supplier-parts", async (req, { params }) => {
  await requirePermission(req, "product:read");
  const { id } = await params;
  return ok(await listPartsForSupplier(id));
});
