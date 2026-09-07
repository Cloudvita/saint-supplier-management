import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3 } from "./clients";

export type StoredObject = { bucket: string; key: string };

/** Build a collision-free, path-safe key under a namespace prefix. */
export function objectKey(prefix: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]/g, "_");
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}/${yyyy}/${mm}/${crypto.randomUUID()}-${safe}`;
}

/**
 * Archive bytes for audit. Returns null when no bucket is configured, so local
 * dev and demos work without S3 — callers treat archiving as best-effort.
 */
export async function putObject(
  bucket: string | undefined,
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<StoredObject | null> {
  if (!bucket) return null;
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  );
  return { bucket, key };
}

/** Short-lived link so a buyer can re-open a stored document. */
export async function presignObject(
  bucket: string | undefined,
  key: string,
  expiresIn = 300
): Promise<string | null> {
  if (!bucket) return null;
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}
