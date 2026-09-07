import { withRoute, ok } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import { intakeContractDocument } from "@/modules/contracts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/contracts/documents  (multipart/form-data: file, contractId?)
 * OCRs an MSA/SOW, extracts commercial metadata and runs the clause audit.
 */
export const POST = withRoute("contracts.documents.intake", async (req) => {
  await requirePermission(req, "contracts:write");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw AppError.badRequest("No file uploaded (field name must be 'file')");
  }
  const contractId = form?.get("contractId");

  return ok(
    await intakeContractDocument(file, typeof contractId === "string" && contractId ? contractId : undefined)
  );
});
