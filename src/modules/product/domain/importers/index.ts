import { readExcelSheets } from "./excel";
import { stepToGraph } from "./step/ap242";
import { boModelXmlToGraph } from "./step/bo-model-xml";
import { stepPackageToGraph } from "./step/package";
import { parseDelimited, rowsToGraph, type ParsedImport } from "./tabular";

/**
 * The importer registry: which formats SAINT can read into the product
 * graph, chosen by file extension. PLMXML and XMI join this list as they
 * are ported from PMem.
 */
export type Importer = {
  format: string;
  label: string;
  extensions: string[];
  parse: (data: Uint8Array, fileName: string) => Promise<ParsedImport>;
};

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "");

/**
 * STEP files are text, nominally ISO 8859-1 with non-ASCII escaped; real
 * exporters also write raw UTF-8. Decode as UTF-8 when the bytes are valid
 * UTF-8, else as Latin-1, so neither kind is mangled.
 */
function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

export const IMPORTERS: Importer[] = [
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
      const sheets = await readExcelSheets(data);
      const first = sheets.find((s) => s.rows.some((r) => r.some((c) => c !== null && c !== "")));
      if (!first) return { document: { format: "EXCEL", name: baseName(fileName), nodes: [], edges: [] }, warnings: ["The workbook has no data"] };
      const parsed = rowsToGraph(first.rows, { format: "EXCEL", name: baseName(fileName) });
      const others = sheets.filter((s) => s !== first && s.rows.length > 0).map((s) => s.sheet);
      if (others.length) parsed.warnings.unshift(`Imported sheet "${first.sheet}"; other sheets ignored: ${others.join(", ")}`);
      return parsed;
    },
  },
];

export function importerFor(fileName: string): Importer | null {
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  return IMPORTERS.find((i) => i.extensions.includes(ext)) ?? null;
}

export type { ParsedImport } from "./tabular";
