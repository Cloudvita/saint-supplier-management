import {
  AnalyzeDocumentCommand,
  type Block,
  type AnalyzeDocumentCommandOutput,
} from "@aws-sdk/client-textract";
import { AppError } from "@/core/errors";
import { getTextract } from "@/core/aws";

export type KeyValuePair = { key: string; value: string; confidence: number };

export type ExtractedDocument = {
  pairs: KeyValuePair[];
  rawText: string;
  /** Mean confidence across detected form fields, 0-100. */
  confidence: number;
};

/** Textract's synchronous AnalyzeDocument limit. */
export const MAX_SYNC_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
];

/**
 * OCR a document into form key/value pairs plus raw text.
 *
 * Deliberately domain-agnostic: this knows nothing about W-9s or contracts.
 * Modules map these pairs onto their own fields (`/suppliers` for W-9 intake,
 * `/contracts` for MSA metadata), so a second document type never means a
 * second OCR integration.
 */
export async function extractDocument(bytes: Uint8Array): Promise<ExtractedDocument> {
  let out: AnalyzeDocumentCommandOutput;
  try {
    out = await getTextract().send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: bytes },
        FeatureTypes: ["FORMS", "TABLES"],
      })
    );
  } catch (e) {
    throw AppError.upstream(
      `Textract extraction failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const blocks = out.Blocks ?? [];
  const pairs = extractKeyValuePairs(blocks);
  const rawText = blocks
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text as string)
    .join("\n");

  const confidence =
    pairs.length > 0 ? pairs.reduce((s, p) => s + p.confidence, 0) / pairs.length : 0;

  return { pairs, rawText, confidence };
}

/** Validate an upload before it reaches Textract. */
export function assertExtractable(file: { size: number; type: string }): void {
  if (file.size > MAX_SYNC_DOCUMENT_BYTES) {
    throw new AppError("BAD_REQUEST", "File exceeds the 10 MB Textract sync limit");
  }
  if (!SUPPORTED_DOCUMENT_TYPES.includes(file.type)) {
    throw new AppError(
      "BAD_REQUEST",
      `Unsupported type ${file.type}. Use PDF, PNG, JPEG or TIFF.`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Textract FORMS -> key/value pairs                                   */
/* ------------------------------------------------------------------ */

function extractKeyValuePairs(blocks: Block[]): KeyValuePair[] {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);

  const pairs: KeyValuePair[] = [];
  for (const b of blocks) {
    if (b.BlockType !== "KEY_VALUE_SET") continue;
    if (!b.EntityTypes?.includes("KEY")) continue;

    const key = textOf(b, byId);
    const valueIds = b.Relationships?.find((r) => r.Type === "VALUE")?.Ids ?? [];
    const value = valueIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((vb) => textOf(vb as Block, byId))
      .join(" ")
      .trim();

    if (key) pairs.push({ key: key.trim(), value, confidence: b.Confidence ?? 0 });
  }
  return pairs;
}

function textOf(block: Block, byId: Map<string, Block>): string {
  const childIds = block.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];
  const parts: string[] = [];
  for (const id of childIds) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.BlockType === "WORD" && c.Text) parts.push(c.Text);
    if (c.BlockType === "SELECTION_ELEMENT" && c.SelectionStatus === "SELECTED") parts.push("[X]");
  }
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Shared lookup helpers for module-level field mapping                */
/* ------------------------------------------------------------------ */

/** Normalise a label for fuzzy matching: lowercase, alphanumerics and spaces. */
export const normalizeLabel = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** First pair whose key contains any of `needles` (already normalised). */
export function findPair(pairs: KeyValuePair[], needles: string[]): string | undefined {
  for (const needle of needles) {
    const hit = pairs.find((p) => normalizeLabel(p.key).includes(needle));
    if (hit?.value?.trim()) return hit.value.trim();
  }
  return undefined;
}
