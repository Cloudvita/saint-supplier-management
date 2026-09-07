/**
 * Export engine — turns any row set into a downloadable artefact.
 *
 * Format-agnostic and dependency-free so `/reports` can serve a CSV to a
 * browser, a JSON payload to an agent, and a Markdown table into a chat reply
 * from the same metric pipeline.
 */
export type ExportFormat = "csv" | "json" | "markdown";

export type ExportColumn<T> = {
  key: keyof T & string;
  header: string;
  /** Render a cell. Defaults to String(value), with null/undefined as "". */
  format?: (value: T[keyof T & string], row: T) => string;
};

const escapeCsv = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function cell<T>(row: T, col: ExportColumn<T>): string {
  const raw = row[col.key];
  if (col.format) return col.format(raw, row);
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((c) => escapeCsv(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => escapeCsv(cell(r, c))).join(","));
  return [header, ...body].join("\n");
}

export function toMarkdown<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = `| ${columns.map((c) => c.header).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${columns.map((c) => cell(r, c).replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export function render<T>(rows: T[], columns: ExportColumn<T>[], format: ExportFormat): string {
  switch (format) {
    case "csv":
      return toCsv(rows, columns);
    case "markdown":
      return toMarkdown(rows, columns);
    case "json":
      return JSON.stringify(rows, null, 2);
  }
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  markdown: "text/markdown; charset=utf-8",
};

export const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  csv: "csv",
  json: "json",
  markdown: "md",
};
