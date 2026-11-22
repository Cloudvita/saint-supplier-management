import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { getImport } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/product/imports/:id — the preview: counts, classes, sample parts, warnings */
export const GET = withRoute<Ctx>("product.imports.get", async (req, { params }) => {
  await requirePermission(req, "product:read");
  const { id } = await params;
  return ok({ import: await getImport(id) });
});
