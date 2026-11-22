import { XMLParser } from "fast-xml-parser";

/**
 * XML for the importers (AP242 BO Model XML now; PLMXML and XMI next), read
 * into a plain tree with every element as an array so traversal code never
 * has to ask "one or many?".
 *
 * Uploads are untrusted. A DOCTYPE is refused outright: engineering exports
 * never need one, and refusing it rules out entity-expansion ("billion
 * laughs") and external-entity attacks regardless of parser settings. PMem
 * used defusedxml for the same reason.
 */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  textNodeName: "#text",
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

export function parseXml(text: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text.slice(0, 64 * 1024))) {
    throw new SyntaxError("XML documents with a DOCTYPE are not accepted");
  }
  return parser.parse(text) as XmlNode;
}

/** Child elements by local name (namespace prefixes are removed on parse). */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  const v = node?.[name];
  return Array.isArray(v) ? (v as XmlNode[]).map((c) => (typeof c === "object" && c !== null ? c : { "#text": String(c) })) : [];
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return children(node, name)[0];
}

export function attr(node: XmlNode | undefined, name: string): string | null {
  const v = node?.[`@${name}`];
  return typeof v === "string" ? v : null;
}

export function text(node: XmlNode | undefined): string | null {
  const v = node?.["#text"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Depth-first visit of every element, with the chain of ancestors. */
export function walk(node: XmlNode, visit: (name: string, el: XmlNode, ancestors: XmlNode[]) => void, ancestors: XmlNode[] = []): void {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@") || key === "#text" || !Array.isArray(value)) continue;
    for (const el of value) {
      if (typeof el !== "object" || el === null) continue;
      visit(key, el as XmlNode, ancestors);
      walk(el as XmlNode, visit, [...ancestors, el as XmlNode]);
    }
  }
}
