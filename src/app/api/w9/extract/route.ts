import { withRoute, ok } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import { intakeW9 } from "@/modules/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/w9/extract   (multipart/form-data, field name: "file")
 * Archives the W-9 in S3, runs Textract, and returns mapped fields so the UI
 * can pre-fill the supplier form. The buyer reviews before saving.
 */
export const POST = withRoute("w9.extract", async (req) => {
  await requirePermission(req, "suppliers:write");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw AppError.badRequest("No file uploaded (field name must be 'file')");
  }

  return ok(await intakeW9(file));
});
