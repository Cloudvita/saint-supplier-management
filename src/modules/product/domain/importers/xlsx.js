// @ts-check
import { unzip } from "./zip.js";
import { attr, child, children, parseXml, text } from "./xml.js";

/**
 * .xlsx reader — no npm package. An .xlsx is a zip of XML parts (Office Open
 * XML, ECMA-376); this reads every worksheet's cell values:
 *
 *   xl/workbook.xml             sheet names, in tab order, with relationship ids
 *   xl/_rels/workbook.xml.rels  relationship id → worksheet part
 *   xl/sharedStrings.xml        the string table cells point into
 *   xl/styles.xml               which cells are dates (by number format)
 *   xl/worksheets/sheetN.xml    rows of cells
 */

/** @typedef {string | number | boolean | Date | null} Cell */
/** @typedef {{ sheet: string; rows: Cell[][] }} SheetRows */

/** A workbook unpacks to far more than its zipped size; cap what is inflated. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

/** Built-in number formats that are dates or times (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * "A1" → 0, "AB12" → 27.
 * @param {string} ref
 */
function columnIndex(ref) {
  let col = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    col = col * 26 + (c - 64);
  }
  return col - 1;
}

/**
 * Excel serial date (1900 system) → Date at UTC midnight-based time.
 * @param {number} serial
 */
function excelDate(serial) {
  // Day 60 is Excel's fictitious 29 Feb 1900; serials after it are one too high.
  const days = serial > 60 ? serial - 1 : serial;
  return new Date(Date.UTC(1899, 11, 31) + Math.round(days * 86400000));
}

/**
 * All text in an <si> or <is>: plain <t>, or the runs <r><t> of rich text.
 * @param {import("./xml.js").XmlNode | undefined} node
 */
function stringItem(node) {
  const plain = children(node, "t").map((t) => text(t) ?? "").join("");
  const runs = children(node, "r").map((r) => text(child(r, "t")) ?? "").join("");
  return plain + runs;
}

/**
 * @param {Record<string, Uint8Array>} parts
 * @param {string} path
 */
function xmlPart(parts, path) {
  const bytes = parts[path];
  return bytes ? parseXml(new TextDecoder("utf-8").decode(bytes)) : undefined;
}

/**
 * Which style indexes (the `s` attribute of a cell) format a date.
 * @param {import("./xml.js").XmlNode | undefined} styles
 */
function dateStyles(styles) {
  const sheet = child(styles, "styleSheet");
  /** @type {Set<number>} */
  const custom = new Set();
  for (const f of children(child(sheet, "numFmts"), "numFmt")) {
    const code = (attr(f, "formatCode") ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (/[dmyhs]/i.test(code)) custom.add(Number(attr(f, "numFmtId")));
  }
  /** @type {Set<number>} */
  const out = new Set();
  children(child(sheet, "cellXfs"), "xf").forEach((xf, idx) => {
    const id = Number(attr(xf, "numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || custom.has(id)) out.add(idx);
  });
  return out;
}

/**
 * Every worksheet of a workbook as rows of cell values, in tab order.
 * @param {Uint8Array} data
 * @returns {SheetRows[]}
 */
export function readXlsx(data) {
  let total = 0;
  const parts = unzip(data, (e) => {
    if (!/^(xl\/|\[Content_Types\])/.test(e.name) || !/\.(xml|rels)$/.test(e.name)) return false;
    total += e.originalSize;
    if (total > MAX_PART_BYTES) throw new RangeError("The workbook unpacks to more than 64 MB");
    return true;
  });
  const workbook = child(xmlPart(parts, "xl/workbook.xml"), "workbook");
  if (!workbook) throw new SyntaxError("not an Excel workbook (no xl/workbook.xml)");

  /** @type {Map<string, string>} */
  const targets = new Map();
  for (const rel of children(child(xmlPart(parts, "xl/_rels/workbook.xml.rels"), "Relationships"), "Relationship")) {
    const t = attr(rel, "Target") ?? "";
    targets.set(attr(rel, "Id") ?? "", t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const shared = children(child(xmlPart(parts, "xl/sharedStrings.xml"), "sst"), "si").map(stringItem);
  const dates = dateStyles(xmlPart(parts, "xl/styles.xml"));

  return children(child(workbook, "sheets"), "sheet").map((s) => {
    const name = attr(s, "name") ?? "Sheet";
    const path = targets.get(attr(s, "id") ?? "");
    const sheetData = child(child(path ? xmlPart(parts, path) : undefined, "worksheet"), "sheetData");
    /** @type {Cell[][]} */
    const rows = [];
    for (const row of children(sheetData, "row")) {
      const r = Number(attr(row, "r") ?? rows.length + 1) - 1;
      /** @type {Cell[]} */
      const cells = [];
      children(row, "c").forEach((c, k) => {
        const ref = attr(c, "r");
        const col = ref ? columnIndex(ref) : k;
        const type = attr(c, "t") ?? "n";
        const raw = text(child(c, "v"));
        /** @type {Cell} */
        let value = null;
        if (type === "s") value = raw === null ? null : shared[Number(raw)] ?? null;
        else if (type === "inlineStr") value = stringItem(child(c, "is"));
        else if (type === "str") value = raw;
        else if (type === "b") value = raw === "1";
        else if (type === "e") value = null; // #N/A, #REF! and the like
        else if (raw !== null) {
          const n = Number(raw);
          value = dates.has(Number(attr(c, "s") ?? -1)) && Number.isFinite(n) ? excelDate(n) : n;
        }
        cells[col] = value;
      });
      rows[r] = Array.from(cells, (v) => (v === undefined ? null : v));
    }
    // Every row as wide as the widest, so a column means the same cell index on every row.
    const width = rows.reduce((w, r) => Math.max(w, r?.length ?? 0), 0);
    return {
      sheet: name,
      rows: Array.from(rows, (r) => {
        const row = r ?? [];
        while (row.length < width) row.push(null);
        return row;
      }),
    };
  });
}
