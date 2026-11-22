import { unzipSync } from "fflate";
import { CLASSES } from "../../graph-model";
import type { GraphDocument, GraphDocumentEdge, GraphDocumentNode } from "../../graph-document";
import type { ParsedImport } from "../tabular";
import { stepToGraph } from "./ap242";
import { boModelXmlToGraph } from "./bo-model-xml";

/**
 * A .zip of STEP files: an assembly and its parts, imported as one source.
 *
 * PLM systems export an assembly as a .stpx (structure) plus one .stp per
 * part (properties, PMI). Imported separately they would make two nodes for
 * every part; packaged together they are merged by part number — structure
 * from the assembly, detail from each part file.
 *
 * Limits are checked against the zip's own directory before anything is
 * inflated, so a small upload cannot expand into gigabytes.
 */

const STEP_EXT = /\.(stp|step|p21|stpx)$/i;
export const MAX_PACKAGE_FILES = 300;
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

const baseName = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

export function stepPackageToGraph(zip: Uint8Array, docName: string): ParsedImport {
  const warnings: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  let count = 0;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith("/") || f.name.startsWith("__MACOSX/") || baseName(f.name).startsWith(".")) return false;
        if (!STEP_EXT.test(f.name)) {
          skipped.push(f.name);
          return false;
        }
        if (f.originalSize > MAX_ENTRY_BYTES) {
          warnings.push(`${f.name}: ${(f.originalSize / 1048576).toFixed(1)} MB unpacked, over the ${MAX_ENTRY_BYTES / 1048576} MB per-file limit; skipped`);
          return false;
        }
        count += 1;
        total += f.originalSize;
        if (count > MAX_PACKAGE_FILES) throw new RangeError(`The zip holds more than ${MAX_PACKAGE_FILES} STEP files`);
        if (total > MAX_PACKAGE_BYTES) {
          throw new RangeError(`The zip unpacks to more than ${MAX_PACKAGE_BYTES / 1048576} MB of STEP files`);
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof RangeError) throw e;
    throw new SyntaxError(`Not a readable zip file: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (skipped.length) warnings.push(`Ignored ${skipped.length} non-STEP file(s): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? " …" : ""}`);

  const names = Object.keys(entries).sort();
  if (names.length === 0) {
    return { document: { format: "STEP", name: docName, nodes: [], edges: [] }, warnings: [...warnings, "The zip has no STEP files"] };
  }

  // Structure files first, so part files enrich nodes that already exist.
  const ordered = [...names.filter((n) => /\.stpx$/i.test(n)), ...names.filter((n) => !/\.stpx$/i.test(n))];
  const nodes = new Map<string, GraphDocumentNode>();
  const edges = new Map<string, GraphDocumentEdge>();
  const fromPartFiles = new Set<string>();

  for (const name of ordered) {
    let parsed: ParsedImport;
    try {
      const text = decodeText(entries[name]);
      parsed = /\.stpx$/i.test(name) ? boModelXmlToGraph(text, baseName(name)) : stepToGraph(text, baseName(name));
    } catch (e) {
      warnings.push(`${name}: ${e instanceof Error ? e.message : String(e)}; skipped`);
      continue;
    }
    for (const w of parsed.warnings) warnings.push(`${name}: ${w}`);
    for (const n of parsed.document.nodes) {
      const existing = nodes.get(n.key);
      if (!existing) {
        nodes.set(n.key, { ...n, properties: { ...n.properties } });
      } else {
        // Same part number from another file: one part. The structure file's
        // classification wins if it says assembly; details are added.
        existing.properties = { ...existing.properties, ...n.properties };
        if (n.className === CLASSES.ASSEMBLY) existing.className = CLASSES.ASSEMBLY;
        if (existing.name !== n.name && existing.name.toLowerCase() !== n.name.toLowerCase()) {
          warnings.push(`${name}: part ${n.key} is "${n.name}" here and "${existing.name}" elsewhere; kept "${existing.name}"`);
        }
      }
      if (!/\.stpx$/i.test(name)) fromPartFiles.add(n.key);
    }
    for (const e of parsed.document.edges) {
      const k = `${e.from}|${e.to}|${e.type}`;
      if (!edges.has(k)) edges.set(k, e);
    }
  }

  // Parts the structure names a geometry file for, whose file was not in the zip.
  const missing = [...nodes.values()].filter((n) => n.properties?.geometryFile && !fromPartFiles.has(n.key));
  if (missing.length && fromPartFiles.size) {
    warnings.push(
      `${missing.length} part(s) in the assembly have no STEP file in the zip, so no attributes or PMI: ` +
        missing.slice(0, 8).map((n) => n.key).join(", ") + (missing.length > 8 ? " …" : "")
    );
  }

  const document: GraphDocument = { format: "STEP", name: docName, nodes: [...nodes.values()], edges: [...edges.values()] };
  return { document, warnings };
}
