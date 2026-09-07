import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { getEnv } from "@/core/config";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { assertExtractable, extractDocument } from "@/core/documents";
import { objectKey, presignObject, putObject } from "@/core/aws";
import { contractDocuments } from "../schema";
import { extractContractMetadata, type ContractExtraction } from "../domain/metadata";
import { applyClauseAudit } from "./contract.service";

const log = createLogger("contracts.documents");

export type ContractIntakeResult = {
  documentId: string;
  contractId: string | null;
  metadata: ContractExtraction;
  confidence: number;
};

/**
 * Archive a contract PDF, OCR it, and pull out commercial metadata plus the
 * clause audit.
 *
 * When `contractId` is given the audit is written straight onto the contract,
 * so the compliance banner reflects the paper that was actually uploaded.
 */
export async function intakeContractDocument(
  file: File,
  contractId?: string
): Promise<ContractIntakeResult> {
  assertExtractable({ size: file.size, type: file.type });
  const bytes = new Uint8Array(await file.arrayBuffer());

  const [doc] = await db
    .insert(contractDocuments)
    .values({
      contractId: contractId ?? null,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    .returning();

  try {
    const key = objectKey("contracts", file.name);
    const stored = await putObject(getEnv().S3_CONTRACT_BUCKET, key, bytes, file.type);
    if (stored) {
      await db
        .update(contractDocuments)
        .set({ s3Bucket: stored.bucket, s3Key: stored.key })
        .where(eq(contractDocuments.id, doc.id));
    }
  } catch (e) {
    log.warn("S3 archive failed, continuing to extraction", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const extracted = await extractDocument(bytes);
  const metadata = extractContractMetadata(extracted.pairs, extracted.rawText);

  await db
    .update(contractDocuments)
    .set({ extractedMetadata: metadata, confidence: extracted.confidence })
    .where(eq(contractDocuments.id, doc.id));

  if (contractId) {
    await applyClauseAudit(contractId, {
      detected: metadata.clauses.detected,
      missing: metadata.clauses.missing,
      riskFlags: metadata.clauses.riskFlags,
    });
  }

  return {
    documentId: doc.id,
    contractId: contractId ?? null,
    metadata,
    confidence: Number(extracted.confidence.toFixed(1)),
  };
}

export async function getContractDocumentUrl(documentId: string): Promise<string | null> {
  const doc = await db.query.contractDocuments.findFirst({
    where: eq(contractDocuments.id, documentId),
  });
  if (!doc) throw AppError.notFound("Contract document");
  if (!doc.s3Key) return null;
  return presignObject(doc.s3Bucket ?? undefined, doc.s3Key);
}
