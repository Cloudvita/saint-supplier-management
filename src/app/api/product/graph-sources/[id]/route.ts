import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { removeGraphSource } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/product/graph-sources/:id — remove an imported file's nodes and
 * links. Supplier links to its parts are kept, under their stored part names.
 */
export const DELETE = withRoute<Ctx>("product.graph-sources.remove", async (req, { params }) => {
  await requirePermission(req, "product:write");
  const { id } = await params;
  await removeGraphSource(id);
  return ok({ ok: true });
});
