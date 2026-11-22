// @ts-check

/**
 * XML reader for the importers (AP242 BO Model XML, the .xlsx parts, and
 * PLMXML / XMI next) — no npm package.
 *
 * A small non-validating parser: elements, attributes, text, CDATA, the
 * five predefined entities and numeric character references. Comments,
 * processing instructions and the XML declaration are skipped.
 *
 * Uploads are untrusted, so a DOCTYPE is refused outright: engineering
 * exports never need one, and without a DTD there are no custom entities to
 * expand ("billion laughs") and no external entities to fetch.
 *
 * The tree it returns: every child element is an array under its local name
 * (namespace prefixes removed), attributes are "@name", text is "#text".
 */

/** @typedef {Record<string, any>} XmlNode */

const PREDEFINED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return /** @type {Record<string, string>} */ (PREDEFINED)[ent] ?? whole;
  });
}

/** @param {string} name */
const localName = (name) => name.slice(name.indexOf(":") + 1);

/**
 * @param {string} text
 * @returns {XmlNode} the document; its single child is the root element
 */
export function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text.slice(0, 64 * 1024))) {
    throw new SyntaxError("XML documents with a DOCTYPE are not accepted");
  }
  /** @type {XmlNode} */
  const doc = {};
  /** @type {Array<{ name: string; node: XmlNode; text: string }>} */
  const stack = [{ name: "", node: doc, text: "" }];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const lt = text.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      top.text += text.slice(i);
      break;
    }
    if (lt > i) top.text += text.slice(i, lt);

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) throw new SyntaxError("unterminated comment");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1) throw new SyntaxError("unterminated CDATA section");
      top.text += "\u0000" + text.slice(lt + 9, end) + "\u0000"; // marked: not entity-decoded
      i = end + 3;
    } else if (text[lt + 1] === "?") {
      const end = text.indexOf("?>", lt + 2);
      if (end === -1) throw new SyntaxError("unterminated processing instruction");
      i = end + 2;
    } else if (text[lt + 1] === "!") {
      throw new SyntaxError(`unsupported markup declaration at offset ${lt}`);
    } else if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) throw new SyntaxError("unterminated end tag");
      const name = text.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new SyntaxError(`</${name}> does not close <${open?.name ?? ""}>`);
      finishText(open);
      i = end + 1;
    } else {
      // Start tag: name, attributes, maybe self-closing. Quotes may hold ">".
      let j = lt + 1;
      while (j < n && !/[\s/>]/.test(text[j])) j++;
      const name = text.slice(lt + 1, j);
      if (!name) throw new SyntaxError(`bad start tag at offset ${lt}`);
      /** @type {XmlNode} */
      const node = {};
      for (;;) {
        while (j < n && /\s/.test(text[j])) j++;
        if (text[j] === ">" || text.startsWith("/>", j)) break;
        const eq = text.indexOf("=", j);
        if (eq === -1) throw new SyntaxError(`bad attribute in <${name}>`);
        const attrName = text.slice(j, eq).trim();
        let q = eq + 1;
        while (/\s/.test(text[q])) q++;
        const quote = text[q];
        if (quote !== '"' && quote !== "'") throw new SyntaxError(`unquoted attribute ${attrName} in <${name}>`);
        const close = text.indexOf(quote, q + 1);
        if (close === -1) throw new SyntaxError(`unterminated attribute ${attrName} in <${name}>`);
        // xmlns declarations are namespace plumbing, not data.
        if (attrName !== "xmlns" && !attrName.startsWith("xmlns:")) {
          node[`@${localName(attrName)}`] = decodeEntities(text.slice(q + 1, close));
        }
        j = close + 1;
      }
      const selfClosing = text.startsWith("/>", j);
      const parent = top.node;
      const key = localName(name);
      (parent[key] ??= []).push(node);
      if (selfClosing) {
        i = j + 2;
      } else {
        stack.push({ name, node, text: "" });
        i = j + 1;
      }
    }
  }
  if (stack.length > 1) throw new SyntaxError(`<${stack[stack.length - 1].name}> is never closed`);
  return doc;
}

/**
 * Decode and trim an element's collected text; CDATA segments are kept as written.
 * @param {{ node: XmlNode; text: string }} frame
 */
function finishText(frame) {
  const parts = frame.text.split("\u0000");
  const value = parts.map((p, k) => (k % 2 === 1 ? p : decodeEntities(p))).join("").trim();
  if (value) frame.node["#text"] = value;
}

/**
 * Child elements by local name.
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @returns {XmlNode[]}
 */
export function children(node, name) {
  const v = node?.[name];
  return Array.isArray(v) ? v : [];
}

/**
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @returns {XmlNode | undefined}
 */
export function child(node, name) {
  return children(node, name)[0];
}

/**
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @returns {string | null}
 */
export function attr(node, name) {
  const v = node?.[`@${name}`];
  return typeof v === "string" ? v : null;
}

/**
 * @param {XmlNode | undefined} node
 * @returns {string | null}
 */
export function text(node) {
  const v = node?.["#text"];
  return typeof v === "string" && v ? v : null;
}

/**
 * Depth-first visit of every element, with the chain of ancestors.
 * @param {XmlNode} node
 * @param {(name: string, el: XmlNode, ancestors: XmlNode[]) => void} visit
 * @param {XmlNode[]} [ancestors]
 */
export function walk(node, visit, ancestors = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@") || key === "#text" || !Array.isArray(value)) continue;
    for (const el of value) {
      visit(key, el, ancestors);
      walk(el, visit, [...ancestors, el]);
    }
  }
}
