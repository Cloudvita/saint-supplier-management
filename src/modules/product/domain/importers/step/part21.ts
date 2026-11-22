/**
 * ISO 10303-21 ("STEP Part 21", .stp/.step) reader: the clear-text exchange
 * format. Turns the DATA section into entity instances with typed parameters.
 *
 * Only reading, and only what the importer needs; nothing here knows what a
 * PRODUCT is. PMem's Python reader split records with regular expressions and
 * kept parameters as raw strings; this one parses them, so strings are
 * decoded (including the \X2\…\X0\ Unicode encoding) and lists and
 * references are real values.
 */

export type P21Value =
  | { kind: "ref"; id: number }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "enum"; value: string }
  | { kind: "list"; items: P21Value[] }
  | { kind: "typed"; type: string; value: P21Value }
  | { kind: "null" } // $
  | { kind: "derived" }; // *

export type P21Entity = {
  id: number;
  /** For a complex instance (#1=(A(...)B(...))), every partial type in order. */
  types: string[];
  /** Parameters per type; for a simple instance, one list. */
  params: P21Value[][];
};

export type P21File = {
  header: { fileName: string | null; originatingSystem: string | null; schema: string | null };
  entities: Map<number, P21Entity>;
};

/* ------------------------------ string codec ------------------------------ */

/**
 * Decode a STEP string literal's contents (quotes already removed):
 * '' → ', \\ → \, \X2\hhhh…\X0\ (UTF-16), \X4\hhhhhhhh…\X0\ (UTF-32),
 * \X\hh (ISO 8859-1), \S\c (c + 128), \P?\ page switches (ignored).
 */
export function decodeStepString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'" && raw[i + 1] === "'") {
      out += "'";
      i++;
    } else if (c === "\\") {
      const rest = raw.slice(i);
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^\\X2\\((?:[0-9A-Fa-f]{4})*)\\X0\\/))) {
        for (let k = 0; k < m[1].length; k += 4) out += String.fromCharCode(parseInt(m[1].slice(k, k + 4), 16));
        i += m[0].length - 1;
      } else if ((m = rest.match(/^\\X4\\((?:[0-9A-Fa-f]{8})*)\\X0\\/))) {
        for (let k = 0; k < m[1].length; k += 8) out += String.fromCodePoint(parseInt(m[1].slice(k, k + 8), 16));
        i += m[0].length - 1;
      } else if ((m = rest.match(/^\\X\\([0-9A-Fa-f]{2})/))) {
        out += String.fromCharCode(parseInt(m[1], 16));
        i += m[0].length - 1;
      } else if ((m = rest.match(/^\\S\\(.)/s))) {
        out += String.fromCharCode(m[1].charCodeAt(0) + 128);
        i += m[0].length - 1;
      } else if ((m = rest.match(/^\\P[A-I]\\/))) {
        i += m[0].length - 1;
      } else if (raw[i + 1] === "\\") {
        out += "\\";
        i++;
      } else {
        out += c;
      }
    } else {
      out += c;
    }
  }
  return out;
}

/* ------------------------------- tokenizer -------------------------------- */

class Cursor {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === " " || c === "\n" || c === "\r" || c === "\t") this.i++;
      else if (c === "/" && this.s[this.i + 1] === "*") {
        const end = this.s.indexOf("*/", this.i + 2);
        this.i = end === -1 ? this.s.length : end + 2;
      } else break;
    }
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  expect(ch: string) {
    if (this.peek() !== ch) throw new SyntaxError(`STEP: expected "${ch}" at offset ${this.i}`);
    this.i++;
  }
  keyword(): string {
    this.ws();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 200));
    if (!m) throw new SyntaxError(`STEP: expected a keyword at offset ${this.i}`);
    this.i += m[0].length;
    return m[0].toUpperCase();
  }
}

function readString(c: Cursor): string {
  c.expect("'");
  let raw = "";
  while (c.i < c.s.length) {
    const ch = c.s[c.i];
    if (ch === "'") {
      if (c.s[c.i + 1] === "'") {
        raw += "''";
        c.i += 2;
        continue;
      }
      c.i++;
      return decodeStepString(raw.replace(/\r?\n/g, ""));
    }
    raw += ch;
    c.i++;
  }
  throw new SyntaxError("STEP: unterminated string");
}

function readValue(c: Cursor): P21Value {
  const ch = c.peek();
  if (ch === "'") return { kind: "string", value: readString(c) };
  if (ch === "#") {
    c.i++;
    const m = /^\d+/.exec(c.s.slice(c.i, c.i + 20));
    if (!m) throw new SyntaxError(`STEP: bad reference at offset ${c.i}`);
    c.i += m[0].length;
    return { kind: "ref", id: Number(m[0]) };
  }
  if (ch === "$") {
    c.i++;
    return { kind: "null" };
  }
  if (ch === "*") {
    c.i++;
    return { kind: "derived" };
  }
  if (ch === ".") {
    const end = c.s.indexOf(".", c.i + 1);
    const value = c.s.slice(c.i + 1, end).toUpperCase();
    c.i = end + 1;
    return { kind: "enum", value };
  }
  if (ch === "(") return { kind: "list", items: readList(c) };
  if (ch === '"') {
    // Binary literal: kept as its hex text.
    const end = c.s.indexOf('"', c.i + 1);
    const value = c.s.slice(c.i + 1, end);
    c.i = end + 1;
    return { kind: "string", value };
  }
  const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(c.s.slice(c.i, c.i + 40));
  if (num) {
    c.i += num[0].length;
    return { kind: "number", value: Number(num[0]) };
  }
  // A typed parameter, e.g. LENGTH_MEASURE(1.5).
  const type = c.keyword();
  c.expect("(");
  const value = readValue(c);
  c.expect(")");
  return { kind: "typed", type, value };
}

function readList(c: Cursor): P21Value[] {
  c.expect("(");
  const items: P21Value[] = [];
  if (c.peek() === ")") {
    c.i++;
    return items;
  }
  for (;;) {
    items.push(readValue(c));
    const next = c.peek();
    c.i++;
    if (next === ")") return items;
    if (next !== ",") throw new SyntaxError(`STEP: expected "," or ")" at offset ${c.i - 1}`);
  }
}

/** Split a section into ";"-terminated records, respecting strings and comments. */
function records(section: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inString = false;
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (inString) {
      if (ch === "'") {
        if (section[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === "/" && section[i + 1] === "*") {
      const end = section.indexOf("*/", i + 2);
      i = end === -1 ? section.length : end + 1;
    } else if (ch === ";") {
      const rec = section.slice(start, i).trim();
      if (rec) out.push(rec);
      start = i + 1;
    }
  }
  return out;
}

function section(text: string, name: "HEADER" | "DATA"): string {
  const re = new RegExp(`(^|;)\\s*${name}\\s*;`, "i");
  const m = re.exec(text);
  if (!m) return "";
  const from = m.index + m[0].length;
  const end = /(^|;)\s*ENDSEC\s*;/i.exec(text.slice(from));
  return end ? text.slice(from, from + end.index + (end[1] ? 1 : 0)) : text.slice(from);
}

function firstString(v: P21Value | undefined): string | null {
  if (!v) return null;
  if (v.kind === "string") return v.value;
  if (v.kind === "list") return firstString(v.items[0]);
  return null;
}

/** Parse a Part 21 file. Throws SyntaxError on a file that is not STEP. */
export function parsePart21(text: string): P21File {
  if (!/^\s*ISO-10303-21\s*;/i.test(text.replace(/^﻿/, ""))) {
    throw new SyntaxError("Not a STEP Part 21 file (it must start with ISO-10303-21;)");
  }

  const header: P21File["header"] = { fileName: null, originatingSystem: null, schema: null };
  for (const rec of records(section(text, "HEADER"))) {
    const c = new Cursor(rec);
    const kw = c.keyword();
    const params = readList(c);
    if (kw === "FILE_NAME") {
      header.fileName = firstString(params[0]);
      header.originatingSystem = firstString(params[5]);
    } else if (kw === "FILE_SCHEMA") {
      header.schema = firstString(params[0]);
    }
  }

  const entities = new Map<number, P21Entity>();
  for (const rec of records(section(text, "DATA"))) {
    const m = /^#(\d+)\s*=\s*/.exec(rec);
    if (!m) continue;
    const id = Number(m[1]);
    const c = new Cursor(rec.slice(m[0].length));
    if (c.peek() === "(") {
      // Complex instance: (TYPE_A(...) TYPE_B(...) ...)
      c.i++;
      const types: string[] = [];
      const params: P21Value[][] = [];
      while (c.peek() !== ")" && c.i < c.s.length) {
        types.push(c.keyword());
        params.push(readList(c));
      }
      entities.set(id, { id, types, params });
    } else {
      const type = c.keyword();
      entities.set(id, { id, types: [type], params: [readList(c)] });
    }
  }
  return { header, entities };
}

/* --------------------------------- access --------------------------------- */

export const str = (v: P21Value | undefined): string | null => (v?.kind === "string" ? v.value : null);
export const ref = (v: P21Value | undefined): number | null => (v?.kind === "ref" ? v.id : null);
export const refs = (v: P21Value | undefined): number[] =>
  v?.kind === "list" ? v.items.map(ref).filter((x): x is number => x !== null) : [];

/** A measure's number, unwrapping typed parameters such as LENGTH_MEASURE(1.5). */
export function num(v: P21Value | undefined): number | null {
  if (!v) return null;
  if (v.kind === "number") return v.value;
  if (v.kind === "typed") return num(v.value);
  return null;
}

/** Simple instances of a type. */
export function ofType(file: P21File, type: string): P21Entity[] {
  const out: P21Entity[] = [];
  for (const e of file.entities.values()) if (e.types.length === 1 && e.types[0] === type) out.push(e);
  return out;
}

/** Instances that are, or include as a partial type, any of the given types. */
export function including(file: P21File, types: string[]): P21Entity[] {
  const set = new Set(types);
  const out: P21Entity[] = [];
  for (const e of file.entities.values()) if (e.types.some((t) => set.has(t))) out.push(e);
  return out;
}
