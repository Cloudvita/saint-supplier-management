import { withRoute, ok, created, intParam } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import { listImports, stageImport, supportedFormats } from "@/modules/product";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/product/imports?limit=25 — recent imports, newest first, and the formats accepted */
export const GET = withRoute("product.imports.list", async (req) => {
  await requirePermission(req, "product:read");
  const url = new URL(req.url);
  return ok({ imports: await listImports(intParam(url, "limit", 25, 100)), formats: supportedFormats() });
});

/**
 * POST /api/product/imports   (multipart/form-data, field name: "file")
 * Parses the file and stages it as a preview. Nothing is written to the
 * graph until POST /api/product/imports/:id/commit.
 */
export const POST = withRoute("product.imports.stage", async (req) => {
  const ctx = await requirePermission(req, "product:write");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw AppError.badRequest("No file uploaded (field name must be 'file')");

  const staged = await stageImport({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, ctx.userId);
  return created({ import: staged });
});
