// @ts-check
import { stepToGraph } from "./step/ap242.js";
import { boModelXmlToGraph } from "./step/bo-model-xml.js";
import { stepPackageToGraph } from "./step/package.js";
import { parseDelimited, rowsToGraph } from "./tabular.js";
import { decodeText } from "./text.js";
import { readXlsx } from "./xlsx.js";

/**
 * The importer registry: which formats SAINT can read into the product
 * graph, chosen by file extension. PLMXML and XMI join this list as they
 * are ported from PMem. Every reader here is plain JavaScript on Node's
 * built-ins (zlib for zip and .xlsx); no npm packages.
 *
 * @typedef {import("../graph-document.js").ParsedImport} ParsedImport
 * @typedef {{
 *   format: string;
 *   label: string;
 *   extensions: string[];
 *   parse: (data: Uint8Array, fileName: string) => Promise<ParsedImport>;
 * }} Importer
 */

/** @param {string} fileName */
const baseName = (fileName) => fileName.replace(/\.[^.]+$/, "");

/** @type {Importer[]} */
export const IMPORTERS = [
  {
    format: "CSV",
    label: "Parts list / BOM (CSV, TSV)",
    extensions: [".csv", ".tsv", ".txt"],
    parse: async (data, fileName) =>
      rowsToGraph(parseDelimited(new TextDecoder("utf-8").decode(data)), { format: "CSV", name: baseName(fileName) }),
  },
  {
    format: "STEP",
    label: "CAD part or assembly (STEP AP242/AP214/AP203)",
    extensions: [".stp", ".step", ".p21"],
    parse: async (data, fileName) => stepToGraph(decodeText(data), baseName(fileName)),
  },
  {
    format: "STEP",
    label: "PLM assembly structure (STEP AP242 BO Model XML)",
    extensions: [".stpx"],
    parse: async (data, fileName) => boModelXmlToGraph(decodeText(data), baseName(fileName)),
  },
  {
    format: "STEP",
    label: "STEP package: assembly and part files (.zip)",
    extensions: [".zip"],
    parse: async (data, fileName) => stepPackageToGraph(data, baseName(fileName)),
  },
  {
    format: "EXCEL",
    label: "Parts list / BOM (Excel .xlsx)",
    extensions: [".xlsx"],
    parse: async (data, fileName) => {
      const sheets = readXlsx(data);
      const first = sheets.find((s) => s.rows.some((r) => r.some((c) => c !== null && c !== "")));
      if (!first) return { document: { format: "EXCEL", name: baseName(fileName), nodes: [], edges: [] }, warnings: ["The workbook has no data"] };
      const parsed = rowsToGraph(first.rows, { format: "EXCEL", name: baseName(fileName) });
      const others = sheets.filter((s) => s !== first && s.rows.length > 0).map((s) => s.sheet);
      if (others.length) parsed.warnings.unshift(`Imported sheet "${first.sheet}"; other sheets ignored: ${others.join(", ")}`);
      return parsed;
    },
  },
];

/**
 * @param {string} fileName
 * @returns {Importer | null}
 */
export function importerFor(fileName) {
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  return IMPORTERS.find((i) => i.extensions.includes(ext)) ?? null;
}
