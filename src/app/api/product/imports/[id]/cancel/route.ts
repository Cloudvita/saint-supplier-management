import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { cancelImport } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/product/imports/:id/cancel — discard a preview without writing it */
export const POST = withRoute<Ctx>("product.imports.cancel", async (req, { params }) => {
  await requirePermission(req, "product:write");
  const { id } = await params;
  return ok({ import: await cancelImport(id) });
});
