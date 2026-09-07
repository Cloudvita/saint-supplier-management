import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { getEnv } from "@/core/config";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { assertExtractable, extractDocument } from "@/core/documents";
import { objectKey, putObject, presignObject } from "@/core/aws";
import { w9Documents } from "../schema";
import { mapToW9Fields, type W9Fields } from "../domain/w9-mapping";

const log = createLogger("suppliers.w9");

export type W9IntakeResult = {
  documentId: string;
  fields: W9Fields;
  confidence: number;
  pairsFound: number;
};

/**
 * Archive an uploaded W-9 and OCR it into supplier fields for the form to
 * pre-fill. The buyer always reviews before the supplier is saved — extraction
 * is a convenience, never an authority.
 */
export async function intakeW9(file: File): Promise<W9IntakeResult> {
  assertExtractable({ size: file.size, type: file.type });
  const bytes = new Uint8Array(await file.arrayBuffer());

  const [doc] = await db
    .insert(w9Documents)
    .values({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      extractionStatus: "PENDING",
    })
    .returning();

  // 1. archive the original — best effort, never blocks extraction
  try {
    const key = objectKey("w9", file.name);
    const stored = await putObject(getEnv().S3_W9_BUCKET, key, bytes, file.type);
    if (stored) {
      await db
        .update(w9Documents)
        .set({ s3Bucket: stored.bucket, s3Key: stored.key })
        .where(eq(w9Documents.id, doc.id));
    }
  } catch (e) {
    log.warn("S3 archive failed, continuing to extraction", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. extract
  try {
    const extracted = await extractDocument(bytes);
    const fields = mapToW9Fields(extracted.pairs, extracted.rawText);

    await db
      .update(w9Documents)
      .set({
        rawExtraction: extracted.pairs,
        parsedFields: fields,
        confidence: extracted.confidence,
        extractionStatus: "EXTRACTED",
      })
      .where(eq(w9Documents.id, doc.id));

    return {
      documentId: doc.id,
      fields,
      confidence: Number(extracted.confidence.toFixed(1)),
      pairsFound: extracted.pairs.length,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Textract failed";
    await db
      .update(w9Documents)
      .set({ extractionStatus: "FAILED", extractionError: message })
      .where(eq(w9Documents.id, doc.id));
    log.error("W-9 extraction failed", { documentId: doc.id, message });
    throw AppError.upstream(`Extraction failed: ${message}`, { documentId: doc.id });
  }
}

/** Short-lived link so a buyer can re-open an archived W-9. */
export async function getW9DownloadUrl(documentId: string): Promise<string | null> {
  const doc = await db.query.w9Documents.findFirst({ where: eq(w9Documents.id, documentId) });
  if (!doc) throw AppError.notFound("W-9 document");
  if (!doc.s3Key) return null;
  return presignObject(doc.s3Bucket ?? undefined, doc.s3Key);
}
