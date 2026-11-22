import readExcelFile from "read-excel-file/node";

export type SheetRows = { sheet: string; rows: Array<Array<string | number | boolean | Date | null>> };

/**
 * Every sheet of an .xlsx workbook as rows of cells. Always given bytes:
 * the library also accepts a file path, which an upload must never become.
 */
export async function readExcelSheets(data: Uint8Array): Promise<SheetRows[]> {
  const sheets = await readExcelFile(Buffer.from(data));
  return sheets.map((s) => ({ sheet: s.sheet, rows: s.data as SheetRows["rows"] }));
}
