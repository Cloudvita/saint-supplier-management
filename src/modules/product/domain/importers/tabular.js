// @ts-check
import { CLASSES, EDGE_TYPES } from "../graph-model.js";

/**
 * Parts lists and BOMs from spreadsheets (CSV, TSV, Excel) into a graph.
 *
 * PMem turned every row into a generic "Row" node. A buyer's spreadsheet is
 * almost always a parts list or an indented BOM, so columns are recognised by
 * the names they usually go by:
 *
 *   name        Name, Part Name, Item Name, Description, Title
 *   key         Part Number, Item ID, PN, ID, Number   (falls back to name)
 *   parent      Parent, Parent Part Number, Assembly   (a key or a name)
 *   level       Level, BOM Level                       (indented BOMs, 0 = top)
 *   quantity    Qty, Quantity                          (on the parent → child link)
 *   class       Type, Class, Item Type                 (part, assembly, requirement ...)
 *   layer       RFLP, Layer                            (R, F, L, P)
 *   links       Satisfies, Realizes, Traces To, Allocates, Linked To,
 *               References, Affects                    (keys or names, ; separated)
 *
 * Every other column is kept as a property under its original heading. A part
 * that appears on several rows (used in several assemblies) becomes one node
 * with several parents.
 *
 * @typedef {import("../graph-document.js").ParsedImport} ParsedImport
 * @typedef {import("../graph-document.js").GraphDocumentNode} GraphDocumentNode
 * @typedef {import("../graph-document.js").GraphDocumentEdge} GraphDocumentEdge
 * @typedef {string | number | boolean | Date | null | undefined} Cell
 * @typedef {"name" | "key" | "parent" | "level" | "quantity" | "class" | "layer"} Role
 */

/** @param {string} s */
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** @type {Record<Role, string[]>} */
const ROLE_ALIASES = {
  name: ["name", "partname", "itemname", "componentname", "description", "title"],
  key: ["partnumber", "partno", "pn", "itemid", "itemnumber", "itemno", "id", "number", "key"],
  parent: ["parent", "parentid", "parentpartnumber", "parentpn", "parentkey", "parentitem", "parentname", "assembly"],
  level: ["level", "bomlevel", "lvl"],
  quantity: ["quantity", "qty"],
  class: ["type", "class", "classname", "itemtype", "kind"],
  layer: ["rflp", "rflplayer", "layer"],
};

/** @type {Record<string, string>} */
const LINK_COLUMNS = {
  satisfies: EDGE_TYPES.SATISFIES,
  realizes: EDGE_TYPES.REALIZES,
  tracesto: EDGE_TYPES.TRACES_TO,
  allocates: EDGE_TYPES.ALLOCATES,
  linkedto: EDGE_TYPES.LINKED_TO,
  references: EDGE_TYPES.REFERENCES,
  affects: EDGE_TYPES.CHANGE_AFFECTS,
  changeaffects: EDGE_TYPES.CHANGE_AFFECTS,
};

/** @type {Record<string, string>} */
const CLASS_ALIASES = {
  part: CLASSES.PART,
  component: CLASSES.PART,
  assembly: CLASSES.ASSEMBLY,
  assy: CLASSES.ASSEMBLY,
  subassembly: CLASSES.ASSEMBLY,
  requirement: CLASSES.REQUIREMENT,
  req: CLASSES.REQUIREMENT,
  process: CLASSES.PROCESS,
  operation: CLASSES.PROCESS,
  changerequest: CLASSES.CHANGE_REQUEST,
  ecr: CLASSES.CHANGE_REQUEST,
  changenotice: CLASSES.CHANGE_NOTICE,
  ecn: CLASSES.CHANGE_NOTICE,
  eco: CLASSES.CHANGE_NOTICE,
  document: CLASSES.DOCUMENT,
  drawing: CLASSES.DOCUMENT,
};

/** Above this, the preview and the write get slow enough to need a different path. */
export const MAX_ROWS = 50_000;
/** Warnings beyond this are summarised, so one bad column cannot produce 50,000 lines. */
const MAX_WARNINGS = 200;

/* --------------------------------- CSV ---------------------------------- */

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF,
 * and a UTF-8 byte-order mark. The delimiter (, ; tab |) is taken from the
 * header line — European Excel exports use semicolons.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseDelimited(text) {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [",", ";", "\t", "|"]
    .map((d) => /** @type {const} */ ([d, firstLine.split(d).length - 1]))
    .sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0][1] > 0 ? counts[0][0] : ",";

  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------ rows → graph ----------------------------- */

/** @param {Cell} v */
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * @param {Cell} v
 * @returns {string | number | boolean | null}
 */
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  return v;
}

/** @param {string} raw */
function className(raw) {
  if (!raw) return null;
  return CLASS_ALIASES[norm(raw)] ?? raw.trim().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Turn a sheet (header row first) into a graph document.
 * @param {Cell[][]} rows
 * @param {{ format: string; name: string }} opts
 * @returns {ParsedImport}
 */
export function rowsToGraph(rows, opts) {
  /** @type {string[]} */
  const warnings = [];
  /** @param {string} msg */
  const warn = (msg) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg);
    else if (warnings.length === MAX_WARNINGS) warnings.push("… more warnings not shown");
  };

  const headerIndex = rows.findIndex((r) => r.some((c) => cellText(c) !== ""));
  if (headerIndex === -1) return { document: { ...opts, nodes: [], edges: [] }, warnings: ["The file has no rows"] };
  const header = rows[headerIndex].map(cellText);
  // Keep each row's position in the sheet, so warnings name the row a person sees.
  const body = rows
    .map((r, i) => ({ r, rowNo: i + 1 }))
    .slice(headerIndex + 1)
    .filter(({ r }) => r.some((c) => cellText(c) !== ""));
  if (body.length > MAX_ROWS) {
    throw new RangeError(`The file has ${body.length} rows; at most ${MAX_ROWS} can be imported at once`);
  }

  // Which column plays which role. First match wins, in the alias order above.
  /** @type {Partial<Record<Role, number>>} */
  const col = {};
  const normalised = header.map(norm);
  for (const [role, aliases] of /** @type {Array<[Role, string[]]>} */ (Object.entries(ROLE_ALIASES))) {
    for (const alias of aliases) {
      const i = normalised.findIndex((h, idx) => h === alias && !Object.values(col).includes(idx));
      if (i !== -1) {
        col[role] = i;
        break;
      }
    }
  }
  /** @type {Array<[string, number]>} */
  const linkCols = [];
  normalised.forEach((h, i) => {
    if (LINK_COLUMNS[h]) linkCols.push([LINK_COLUMNS[h], i]);
  });

  if (col.name === undefined && col.key === undefined) {
    col.name = 0;
    warn(`No name or part-number column found; using the first column ("${header[0]}") as the name`);
  }
  if (col.parent !== undefined && col.level !== undefined) {
    warn("Both a parent and a level column are present; using the parent column");
  }

  const roleCols = new Set([
    ...Object.values(col).filter((i) => i !== undefined),
    ...linkCols.map(([, i]) => i),
  ]);
  const propertyCols = header.map((h, i) => /** @type {const} */ ([h, i])).filter(([h, i]) => h && !roleCols.has(i));

  /** @type {Map<string, GraphDocumentNode>} */
  const nodes = new Map();
  /** @type {Map<string, string>} */
  const keyByName = new Map();
  /** @type {Array<{ childKey: string; ref: string; quantity: number | null; row: number }>} */
  const parentRefs = [];
  /** @type {Array<{ fromKey: string; ref: string; type: string; row: number }>} */
  const linkRefs = [];
  /** @type {string[]} */
  const levelStack = [];
  /** @type {Array<{ parentKey: string; childKey: string; quantity: number | null }>} */
  const levelParents = [];

  body.forEach(({ r, rowNo }) => {
    const name = cellText(r[col.name ?? -1]) || cellText(r[col.key ?? -1]);
    if (!name) {
      warn(`Row ${rowNo}: no name or part number; skipped`);
      return;
    }
    const key = cellText(r[col.key ?? -1]) || name;
    const qtyText = cellText(r[col.quantity ?? -1]);
    const quantity = qtyText === "" ? null : Number(qtyText);
    if (quantity !== null && !Number.isFinite(quantity)) warn(`Row ${rowNo}: quantity "${qtyText}" is not a number; ignored`);
    const qty = quantity !== null && Number.isFinite(quantity) ? quantity : null;

    const existing = nodes.get(key);
    if (existing) {
      // The same part on another row: another place it is used, not a new part.
      if (existing.name !== name) warn(`Row ${rowNo}: part ${key} is named "${name}" here but "${existing.name}" earlier; kept the first`);
    } else {
      /** @type {Record<string, unknown>} */
      const properties = {};
      for (const [h, i] of propertyCols) {
        const v = cellValue(r[i]);
        if (v !== null) properties[h] = v;
      }
      const layerText = cellText(r[col.layer ?? -1]).toUpperCase();
      const layer = /** @type {const} */ (["R", "F", "L", "P"]).find((l) => l === layerText[0]) ?? null;
      if (layerText && !layer) warn(`Row ${rowNo}: RFLP layer "${layerText}" is not R, F, L or P; ignored`);
      const rawClass = cellText(r[col.class ?? -1]);
      nodes.set(key, {
        key,
        name,
        className: className(rawClass),
        sourceTag: rawClass || "Row",
        rflpLayer: layer,
        properties,
      });
      if (!keyByName.has(name.toLowerCase())) keyByName.set(name.toLowerCase(), key);
    }

    if (col.parent !== undefined) {
      const ref = cellText(r[col.parent]);
      if (ref) parentRefs.push({ childKey: key, ref, quantity: qty, row: rowNo });
    } else if (col.level !== undefined) {
      const levelText = cellText(r[col.level]);
      // "2", or dots as some PLM exports indent: "." = 1, ".." = 2.
      const level = /^\.+$/.test(levelText) ? levelText.length : Number(levelText);
      if (levelText === "" || !Number.isInteger(level) || level < 0) {
        warn(`Row ${rowNo}: level "${levelText}" is not a whole number; placed at the top`);
        levelStack.length = 0;
        levelStack[0] = key;
      } else {
        if (level > levelStack.length) warn(`Row ${rowNo}: level ${level} skips a level; attached to the nearest parent`);
        const depth = Math.min(level, levelStack.length);
        if (depth > 0) levelParents.push({ parentKey: levelStack[depth - 1], childKey: key, quantity: qty });
        levelStack.length = depth;
        levelStack[depth] = key;
      }
    }

    for (const [type, i] of linkCols) {
      for (const ref of cellText(r[i]).split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
        linkRefs.push({ fromKey: key, ref, type, row: rowNo });
      }
    }
  });

  /** @param {string} ref */
  const resolve = (ref) => (nodes.has(ref) ? ref : keyByName.get(ref.toLowerCase()));
  /** @type {GraphDocumentEdge[]} */
  const edges = [];
  /**
   * @param {string} from
   * @param {string} to
   * @param {number | null} quantity
   */
  const childEdge = (from, to, quantity) => {
    if (from === to) return;
    edges.push({ from, to, type: EDGE_TYPES.HAS_CHILD, properties: quantity === null ? {} : { quantity } });
  };
  for (const p of parentRefs) {
    const parentKey = resolve(p.ref);
    if (!parentKey) warn(`Row ${p.row}: parent "${p.ref}" is not a part in this file; link skipped`);
    else childEdge(parentKey, p.childKey, p.quantity);
  }
  for (const p of levelParents) childEdge(p.parentKey, p.childKey, p.quantity);
  for (const l of linkRefs) {
    const target = resolve(l.ref);
    if (!target) warn(`Row ${l.row}: ${l.type} target "${l.ref}" is not in this file; link skipped`);
    else if (target !== l.fromKey) {
      edges.push({ from: l.fromKey, to: target, type: l.type, properties: l.type === EDGE_TYPES.CHANGE_AFFECTS ? { role: "impacted" } : {} });
    }
  }

  // An unclassified row with children is an assembly; without, a part.
  const parents = new Set(edges.filter((e) => e.type === EDGE_TYPES.HAS_CHILD).map((e) => e.from));
  for (const n of nodes.values()) {
    if (!n.className) n.className = parents.has(n.key) ? CLASSES.ASSEMBLY : CLASSES.PART;
  }

  return { document: { ...opts, nodes: [...nodes.values()], edges }, warnings };
}
