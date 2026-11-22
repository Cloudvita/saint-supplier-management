import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { graphImports, type GraphImport, type GraphSource } from "../schema";
import { IMPORTERS, importerFor } from "../domain/importers";
import type { GraphDocument } from "../domain/graph-document";
import { writeGraph } from "./graph-writer";
import { existingKeys } from "./graph.repository";

const log = createLogger("product.import");

/**
 * Engineering-file import: upload → preview → commit, as in PMem.
 *
 * An upload is parsed straight away and staged as a PREVIEW, with a summary
 * a person can check (how many parts, which classes, what went wrong).
 * Nothing enters the graph until the import is committed. Parsing happens in
 * the request: serverless hosting has no background workers, and the size
 * cap below keeps a parse well inside a request's time.
 */

/** Vercel caps a function's request body at 4.5 MB; stay under it with a clear message. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
/** Previews nobody committed are cleared after this long. */
const PREVIEW_TTL_DAYS = 7;
const SAMPLE_SIZE = 10;

export type ImportView = {
  id: string;
  format: string;
  fileName: string;
  status: GraphImport["status"];
  summary: ImportSummary;
  warnings: string[];
  sourceId: string | null;
  createdBy: string | null;
  committedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportSummary = {
  nodes: number;
  edges: number;
  /** Node count per class, largest first. */
  classes: Array<{ className: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
  /** Nodes nothing points at with HAS_CHILD: the top of each assembly tree. */
  topLevel: number;
  sample: Array<{ key: string; name: string; className: string | null }>;
};

function tally(values: string[]): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function summarise(doc: GraphDocument): ImportSummary {
  const children = new Set(doc.edges.filter((e) => e.type === "HAS_CHILD").map((e) => e.to));
  return {
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    classes: tally(doc.nodes.map((n) => n.className ?? "(none)")).map((t) => ({ className: t.value, count: t.count })),
    edgeTypes: tally(doc.edges.map((e) => e.type)).map((t) => ({ type: t.value, count: t.count })),
    topLevel: doc.nodes.filter((n) => !children.has(n.key)).length,
    sample: doc.nodes.slice(0, SAMPLE_SIZE).map((n) => ({ key: n.key, name: n.name, className: n.className ?? null })),
  };
}

function toView(row: GraphImport): ImportView {
  return {
    id: row.id,
    format: row.format,
    fileName: row.fileName,
    status: row.status,
    summary: row.summary as ImportSummary,
    warnings: row.warnings,
    sourceId: row.sourceId,
    createdBy: row.createdBy,
    committedBy: row.committedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function supportedFormats() {
  return IMPORTERS.map((i) => ({ format: i.format, label: i.label, extensions: i.extensions }));
}

/** Parse an uploaded file and stage it for review. */
export async function stageImport(file: { name: string; bytes: Uint8Array }, createdBy: string): Promise<ImportView> {
  if (file.bytes.byteLength === 0) throw AppError.badRequest("The file is empty");
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw AppError.badRequest(`The file is ${(file.bytes.byteLength / 1048576).toFixed(1)} MB; the limit is 4 MB`);
  }
  if (/\.xls$/i.test(file.name)) throw AppError.badRequest("Legacy .xls files are not supported; save the sheet as .xlsx");
  const importer = importerFor(file.name);
  if (!importer) {
    const known = IMPORTERS.flatMap((i) => i.extensions).join(", ");
    throw AppError.badRequest(`"${file.name}" is not a supported format (${known})`);
  }

  let parsed;
  try {
    parsed = await importer.parse(file.bytes, file.name);
  } catch (e) {
    if (e instanceof RangeError) throw AppError.badRequest(e.message);
    log.warn("import parse failed", { fileName: file.name, format: importer.format, error: e instanceof Error ? e.message : String(e) });
    throw AppError.validation(`Could not read "${file.name}" as ${importer.label}`, {
      file: [e instanceof Error ? e.message : String(e)],
    });
  }
  if (parsed.document.nodes.length === 0) {
    throw AppError.validation(`No parts found in "${file.name}"`, { file: parsed.warnings.length ? parsed.warnings : ["No rows"] });
  }

  // Parts already in the graph from another file would be duplicated; say
  // so, and name the import that a replace would update instead.
  const overlaps = await existingKeys(parsed.document.nodes.map((n) => n.key));
  for (const o of overlaps.slice(0, 3)) {
    parsed.warnings.unshift(
      `${o.keys.length} part(s) are already in the graph from "${o.sourceName}" (${o.keys.slice(0, 5).join(", ")}${o.keys.length > 5 ? " …" : ""}). ` +
        `Committing adds a second copy; to update that import instead, commit with replaceSourceId ${o.sourceId}.`
    );
  }

  await expireOldPreviews();
  const [row] = await db
    .insert(graphImports)
    .values({
      format: importer.format,
      fileName: file.name.slice(0, 300),
      document: parsed.document as unknown as Record<string, unknown>,
      summary: summarise(parsed.document),
      warnings: parsed.warnings,
      createdBy,
    })
    .returning();

  log.info("import staged", { importId: row.id, format: row.format, nodes: parsed.document.nodes.length });
  return toView(row);
}

async function expireOldPreviews(): Promise<void> {
  await db
    .update(graphImports)
    .set({ status: "CANCELLED", document: null })
    .where(
      and(
        eq(graphImports.status, "PREVIEW"),
        lt(graphImports.createdAt, sql`now() - make_interval(days => ${PREVIEW_TTL_DAYS})`)
      )
    );
}

export async function getImport(id: string): Promise<ImportView> {
  const [row] = await db.select().from(graphImports).where(eq(graphImports.id, id));
  if (!row) throw AppError.notFound("Import");
  return toView(row);
}

export async function listImports(limit = 25): Promise<ImportView[]> {
  const rows = await db.select().from(graphImports).orderBy(desc(graphImports.createdAt)).limit(Math.min(limit, 100));
  return rows.map(toView);
}

/**
 * Write a staged import into the graph. With `replaceSourceId`, the earlier
 * import of the same file is replaced in the same transaction and parts
 * keep their ids (see `writeGraph`).
 *
 * The PREVIEW → COMMITTED claim happens first, so two people committing the
 * same preview cannot write it twice; a failed write hands it back.
 */
export async function commitImport(
  id: string,
  committedBy: string,
  opts: { replaceSourceId?: string } = {}
): Promise<{ import: ImportView; source: GraphSource }> {
  const [claimed] = await db
    .update(graphImports)
    .set({ status: "COMMITTED", committedBy })
    .where(and(eq(graphImports.id, id), eq(graphImports.status, "PREVIEW")))
    .returning();
  if (!claimed) {
    const existing = await getImport(id);
    throw AppError.conflict(`Import is ${existing.status.toLowerCase()}, not awaiting commit`);
  }

  let source: GraphSource;
  try {
    source = await writeGraph(claimed.document as unknown as GraphDocument, committedBy, opts);
  } catch (e) {
    await db.update(graphImports).set({ status: "PREVIEW", committedBy: null }).where(eq(graphImports.id, id));
    throw e;
  }

  const [done] = await db
    .update(graphImports)
    .set({ sourceId: source.id, document: null })
    .where(eq(graphImports.id, id))
    .returning();
  log.info("import committed", { importId: id, sourceId: source.id, replaced: opts.replaceSourceId ?? null });
  return { import: toView(done), source };
}

export async function cancelImport(id: string): Promise<ImportView> {
  const [row] = await db
    .update(graphImports)
    .set({ status: "CANCELLED", document: null })
    .where(and(eq(graphImports.id, id), eq(graphImports.status, "PREVIEW")))
    .returning();
  if (!row) {
    const existing = await getImport(id);
    throw AppError.conflict(`Import is ${existing.status.toLowerCase()} and cannot be cancelled`);
  }
  return toView(row);
}
