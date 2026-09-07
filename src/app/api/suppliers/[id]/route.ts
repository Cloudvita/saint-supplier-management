import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import {
  deleteSupplier,
  getSupplier,
  supplierSchema,
  updateSupplier,
} from "@/modules/suppliers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRoute<Ctx>("suppliers.get", async (req, { params }) => {
  await requirePermission(req, "suppliers:read");
  const { id } = await params;
  return ok({ supplier: await getSupplier(id) });
});

export const PATCH = withRoute<Ctx>("suppliers.update", async (req, { params }) => {
  await requirePermission(req, "suppliers:write");
  const { id } = await params;
  const patch = await parseJson(req, supplierSchema.partial());
  return ok({ supplier: await updateSupplier(id, patch) });
});

export const DELETE = withRoute<Ctx>("suppliers.delete", async (req, { params }) => {
  await requirePermission(req, "suppliers:admin");
  const { id } = await params;
  await deleteSupplier(id);
  return ok({ ok: true });
});
