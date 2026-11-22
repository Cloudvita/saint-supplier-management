import { readExcelSheets } from "./excel";
import { parseDelimited, rowsToGraph, type ParsedImport } from "./tabular";

/**
 * The importer registry: which formats SAINT can read into the product
 * graph, chosen by file extension. STEP, PLMXML and XMI join this list as
 * they are ported from PMem.
 */
export type Importer = {
  format: string;
  label: string;
  extensions: string[];
  parse: (data: Uint8Array, fileName: string) => Promise<ParsedImport>;
};

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "");

export const IMPORTERS: Importer[] = [
  {
    format: "CSV",
    label: "Parts list / BOM (CSV, TSV)",
    extensions: [".csv", ".tsv", ".txt"],
    parse: async (data, fileName) =>
      rowsToGraph(parseDelimited(new TextDecoder("utf-8").decode(data)), { format: "CSV", name: baseName(fileName) }),
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
