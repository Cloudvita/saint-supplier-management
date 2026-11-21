import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { removePartSource, updatePartSource, updatePartSourceSchema } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/product/sources/:id { status?, unitPrice?, leadTimeDays?, ... } */
export const PATCH = withRoute<Ctx>("product.sources.update", async (req, { params }) => {
  await requirePermission(req, "product:write");
  const { id } = await params;
  const patch = await parseJson(req, updatePartSourceSchema);
  return ok({ partSource: await updatePartSource(id, patch) });
});

/** DELETE /api/product/sources/:id — remove a supplier ↔ part link */
export const DELETE = withRoute<Ctx>("product.sources.remove", async (req, { params }) => {
  await requirePermission(req, "product:write");
  const { id } = await params;
  await removePartSource(id);
  return ok({ ok: true });
});
