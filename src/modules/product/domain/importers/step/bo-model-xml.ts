import { CLASSES, EDGE_TYPES } from "../../graph-model";
import type { GraphDocumentEdge, GraphDocumentNode } from "../../graph-document";
import type { ParsedImport } from "../tabular";
import { attr, child, children, parseXml, text, walk, type XmlNode } from "../xml";
import { splitTeamcenterName } from "./ap242";

/**
 * AP242 Business Object Model XML (ISO 10303-3001, .stpx): how PLM systems
 * exchange assembly structure, with each part's geometry in a separate .stp.
 *
 *   Part > Versions > PartVersion > Views > PartView        a part and its design view
 *   PartView > Occurrence                                    an instance of this part
 *   PartView > ViewOccurrenceRelationship > Related          a parent using an instance
 *   PartView > DocumentAssignment > AssignedDocument → File  the part's geometry file
 *
 * A ViewOccurrenceRelationship sits in the parent's view and points at an
 * Occurrence that sits in the child's view; counting those per pair gives
 * the quantity.
 */

function partNumberAndName(part: XmlNode): { key: string; name: string; revision: string | null } | null {
  const id = attr(child(part, "Id"), "id") ?? attr(child(child(part, "Id"), "Identifier"), "id");
  const name = text(child(child(part, "Name"), "CharacterString")) ?? id;
  if (!id && !name) return null;
  const split = splitTeamcenterName(id ?? "") ?? splitTeamcenterName(name ?? "");
  return { key: split?.partNumber ?? (id as string), name: split?.name ?? (name as string), revision: split?.revision ?? null };
}

export function boModelXmlToGraph(xmlText: string, docName: string): ParsedImport {
  const root = parseXml(xmlText);
  const warnings: string[] = [];

  // Files, for geometry-file properties.
  const fileNames = new Map<string, string>();
  walk(root, (name, el) => {
    if (name !== "File") return;
    const uid = attr(el, "uid");
    const fileId = attr(child(el, "Id"), "id");
    if (uid && fileId) fileNames.set(uid, fileId);
  });

  const nodes = new Map<string, GraphDocumentNode>();
  const viewOwner = new Map<string, string>(); // PartView uid → part key
  const occurrenceOwner = new Map<string, string>(); // Occurrence uid → part key
  const uses: Array<{ parentKey: string; occurrence: string }> = [];

  walk(root, (name, part) => {
    if (name !== "Part") return;
    const ident = partNumberAndName(part);
    if (!ident) {
      warnings.push(`A Part (${attr(part, "uid") ?? "no uid"}) has no id or name; skipped`);
      return;
    }
    let key = ident.key;
    if (nodes.has(key)) {
      warnings.push(`Two parts share part number ${key}; the second is kept as ${key}#${attr(part, "uid")}`);
      key = `${key}#${attr(part, "uid")}`;
    }
    const partType = text(child(child(part, "PartTypes"), "ClassString"));
    const versions = children(child(part, "Versions"), "PartVersion");
    const revision = ident.revision ?? (versions.map((v) => attr(child(v, "Id"), "id")).find((r) => r) || null);
    const properties: Record<string, unknown> = { stepPartId: attr(child(part, "Id"), "id") ?? undefined };
    if (revision) properties.revision = revision;

    for (const version of versions) {
      for (const view of children(child(version, "Views"), "PartView")) {
        const viewUid = attr(view, "uid");
        if (viewUid) viewOwner.set(viewUid, key);
        for (const occ of children(view, "Occurrence")) {
          const uid = attr(occ, "uid");
          if (uid) occurrenceOwner.set(uid, key);
        }
        for (const rel of children(view, "ViewOccurrenceRelationship")) {
          const related = attr(child(rel, "Related"), "uidRef");
          if (related) uses.push({ parentKey: key, occurrence: related });
        }
        const files = children(view, "DocumentAssignment")
          .map((d) => fileNames.get(attr(child(d, "AssignedDocument"), "uidRef") ?? ""))
          .filter((f): f is string => Boolean(f));
        if (files.length) properties.geometryFile = files.join("; ");
      }
    }

    nodes.set(key, {
      key,
      name: ident.name,
      className: /assembly/i.test(partType ?? "") ? CLASSES.ASSEMBLY : CLASSES.PART,
      sourceTag: "Part",
      rflpLayer: "P",
      properties: Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== undefined)),
    });
  });

  const quantities = new Map<string, number>();
  for (const u of uses) {
    const childKey = occurrenceOwner.get(u.occurrence);
    if (!childKey) {
      warnings.push(`An occurrence used by ${u.parentKey} (${u.occurrence}) belongs to no part in the file; skipped`);
      continue;
    }
    if (childKey === u.parentKey) continue;
    const k = `${u.parentKey}|${childKey}`;
    quantities.set(k, (quantities.get(k) ?? 0) + 1);
  }
  const edges: GraphDocumentEdge[] = [...quantities].map(([k, quantity]) => {
    const [from, to] = k.split("|");
    return { from, to, type: EDGE_TYPES.HAS_CHILD, properties: { quantity } };
  });
  for (const e of edges) nodes.get(e.from)!.className = CLASSES.ASSEMBLY;

  if (nodes.size === 0) warnings.push("No Part elements found; is this an AP242 BO Model XML file?");
  return { document: { format: "STEP", name: docName, nodes: [...nodes.values()], edges }, warnings };
}
