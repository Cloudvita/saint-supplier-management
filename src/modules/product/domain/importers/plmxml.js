// @ts-check
import { CLASSES, EDGE_TYPES } from "../graph-model.js";
import { attr, child, children, text, walk } from "./xml.js";

/**
 * Siemens PLMXML (Teamcenter exports) into the product graph.
 *
 *   Product / ProductRevision (subType)      → an item: part, requirement, function,
 *                                              logical component, change, document
 *   ProductView > Occurrence (instancedRef,  → assembly structure, HAS_CHILD with quantity
 *     occurrenceRefs / parentRef)
 *   InstanceGraph: … instanceRefs → ProductInstance (partRef)
 *                                            → the same, for instance-graph exports
 *   Process / Operation (+ ProcessOccurrence) → processes, their structure, the parts they use
 *   GeneralRelation subType                  → trace and change links (see RELATIONS)
 *   AssociatedForm → Form > UserData, UserData > UserValue
 *                                            → properties (Item Master attributes and the like)
 *   AssociatedDataSet → DataSet / Document    → Document nodes, REFERENCES
 *
 * An item's revisions become one node, keyed by its item id (productId),
 * carrying the latest revision in the file — the same identity STEP and BOM
 * imports use, so the three formats line up by part number.
 *
 * @typedef {import("../graph-document.js").ParsedImport} ParsedImport
 * @typedef {import("../graph-document.js").GraphDocumentNode} GraphDocumentNode
 * @typedef {import("../graph-document.js").GraphDocumentEdge} GraphDocumentEdge
 * @typedef {import("./xml.js").XmlNode} XmlNode
 */

/**
 * Teamcenter subType → class and RFLP layer. PMem's RFLP map, plus the
 * classes the analyses look for. Matched without a "Revision" suffix.
 * @type {Record<string, { className: string; layer: "R" | "F" | "L" | "P" | null }>}
 */
const SUBTYPES = {
  Item: { className: CLASSES.PART, layer: "P" },
  Part: { className: CLASSES.PART, layer: "P" },
  Design: { className: CLASSES.PART, layer: "P" },
  Requirement: { className: CLASSES.REQUIREMENT, layer: "R" },
  RequirementSpec: { className: CLASSES.REQUIREMENT, layer: "R" },
  Sys0SystemFunc: { className: "Function", layer: "F" },
  Sys0LogicalFunc: { className: "Function", layer: "F" },
  Sys0PhysicalFunc: { className: "Function", layer: "F" },
  Sys0LogicalComp: { className: "LogicalComponent", layer: "L" },
  Sys0PhysNodeComp: { className: CLASSES.PART, layer: "P" },
  ChangeRequest: { className: CLASSES.CHANGE_REQUEST, layer: null },
  ChangeNotice: { className: CLASSES.CHANGE_NOTICE, layer: null },
  ProblemReport: { className: CLASSES.CHANGE_REQUEST, layer: null },
  Document: { className: CLASSES.DOCUMENT, layer: null },
  MEProcess: { className: CLASSES.PROCESS, layer: "P" },
  MEOP: { className: CLASSES.PROCESS, layer: "P" },
};

/**
 * GeneralRelation subTypes. `relatedRefs` lists the primary object first,
 * the secondary second; PMem read Seg0Satisfy as requirement → item and the
 * CM relations as change → item, and so does this.
 * @type {Record<string, { type: string; role?: string }>}
 */
const RELATIONS = {
  Seg0Satisfy: { type: EDGE_TYPES.SATISFIES },
  FND_TraceLink: { type: EDGE_TYPES.TRACES_TO },
  Seg0Realize: { type: EDGE_TYPES.REALIZES },
  Seg0Allocate: { type: EDGE_TYPES.ALLOCATES },
  CMHasImpactedItem: { type: EDGE_TYPES.CHANGE_AFFECTS, role: "impacted" },
  CMHasProblemItem: { type: EDGE_TYPES.CHANGE_AFFECTS, role: "problem" },
  CMHasSolutionItem: { type: EDGE_TYPES.CHANGE_AFFECTS, role: "solution" },
  CMReferences: { type: EDGE_TYPES.REFERENCES },
};

const ITEM_TAGS = new Set(["Product", "ProductRevision", "Part", "PartRevision", "Requirement", "RequirementRevision", "ChangeNotice", "ChangeRequest"]);
const PROCESS_TAGS = new Set(["Process", "ProcessRevision", "Operation", "OperationRevision"]);
const DOCUMENT_TAGS = new Set(["DataSet", "Document", "DocumentRevision"]);

/**
 * "#id1 #id2" or "id1,id2" → ["id1", "id2"].
 * @param {string | null} value
 */
const refList = (value) => (value ?? "").split(/[\s,]+/).map((r) => r.replace(/^#/, "")).filter(Boolean);

/**
 * Teamcenter revision ids sort as letters (A < B < … < AA) or numbers.
 * @param {string} a
 * @param {string} b
 */
function compareRevision(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.length - b.length || a.localeCompare(b);
}

/**
 * UserData > UserValue (title, value) on an element, as properties.
 * @param {XmlNode} el
 * @returns {Record<string, string>}
 */
function userValues(el) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const ud of children(el, "UserData")) {
    for (const uv of children(ud, "UserValue")) {
      const title = attr(uv, "title") ?? attr(uv, "name");
      const value = attr(uv, "value") ?? text(uv);
      if (title && value !== null && value !== "") out[title] = value;
    }
  }
  return out;
}

/** @param {string | null} subType */
function classify(subType) {
  const base = (subType ?? "").replace(/Revision$/, "");
  return SUBTYPES[base] ?? null;
}

/**
 * @param {XmlNode} root
 * @param {string} docName
 * @returns {ParsedImport}
 */
export function plmxmlToGraph(root, docName) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, XmlNode>} every element with an id */
  const byId = new Map();
  /** @type {Array<{ tag: string; el: XmlNode }>} */
  const all = [];
  walk(root, (tag, el) => {
    const id = attr(el, "id");
    if (id) byId.set(id, el);
    all.push({ tag, el });
  });
  const tagOf = new Map(all.map(({ tag, el }) => [el, tag]));

  /**
   * Each item, by the key it gets in the graph; masters and revisions of one
   * item share a key.
   * @type {Map<string, { key: string; name: string; subType: string | null; tag: string; revisions: string[]; properties: Record<string, unknown> }>}
   */
  const items = new Map();
  /** @type {Map<string, string>} element id (master or revision) → item key */
  const itemKeyOf = new Map();

  /**
   * @param {XmlNode} el
   * @param {string} tag
   */
  const addItem = (el, tag) => {
    const id = attr(el, "id");
    if (!id) return;
    const master = byId.get((attr(el, "masterRef") ?? "").replace(/^#/, ""));
    const key = attr(el, "productId") ?? attr(el, "itemId") ?? attr(master, "productId") ?? attr(master, "itemId") ?? attr(el, "catalogueId") ?? id;
    const name = attr(el, "name") ?? attr(master, "name") ?? key;
    const entry = items.get(key) ?? { key, name, subType: null, tag, revisions: [], properties: {} };
    entry.subType ??= attr(el, "subType") ?? attr(master, "subType");
    if (!items.has(key)) items.set(key, entry);
    const revision = attr(el, "revision") ?? attr(el, "revisionId");
    if (revision) entry.revisions.push(revision);
    const description = attr(el, "description");
    if (description) entry.properties.description = description;
    const body = text(child(el, "PlainText"));
    if (body) entry.properties.bodyText = body;
    Object.assign(entry.properties, userValues(el));
    // Item Master and other forms attached to the revision.
    for (const af of children(el, "AssociatedForm")) {
      const form = byId.get((attr(af, "formRef") ?? "").replace(/^#/, ""));
      if (form) Object.assign(entry.properties, userValues(form));
    }
    itemKeyOf.set(id, key);
  };

  for (const { tag, el } of all) if (ITEM_TAGS.has(tag)) addItem(el, tag);
  for (const { tag, el } of all) if (PROCESS_TAGS.has(tag)) addItem(el, tag);

  // Documents attached to items.
  /** @type {Array<{ from: string; to: string }>} */
  const docLinks = [];
  for (const { tag, el } of all) {
    if (!DOCUMENT_TAGS.has(tag)) continue;
    const id = attr(el, "id");
    if (!id) continue;
    const key = `doc:${id}`;
    items.set(key, {
      key,
      name: attr(el, "name") ?? id,
      subType: "Document",
      tag,
      revisions: attr(el, "revision") ? [/** @type {string} */ (attr(el, "revision"))] : [],
      properties: { ...(attr(el, "type") ? { documentType: attr(el, "type") } : {}), ...userValues(el) },
    });
    itemKeyOf.set(id, key);
  }
  for (const { tag, el } of all) {
    if (!ITEM_TAGS.has(tag) && !PROCESS_TAGS.has(tag)) continue;
    const from = itemKeyOf.get(attr(el, "id") ?? "");
    for (const ads of children(el, "AssociatedDataSet")) {
      const to = itemKeyOf.get((attr(ads, "dataSetRef") ?? "").replace(/^#/, ""));
      if (from && to) docLinks.push({ from, to });
    }
  }

  // --- structure: occurrences and instances ---------------------------------
  /** @type {Map<string, number>} "parent|child" → quantity */
  const usage = new Map();
  /**
   * @param {string | undefined} parentKey
   * @param {string | undefined} childKey
   * @param {number} quantity
   */
  const use = (parentKey, childKey, quantity) => {
    if (!parentKey || !childKey || parentKey === childKey) return;
    const k = `${parentKey}|${childKey}`;
    usage.set(k, (usage.get(k) ?? 0) + quantity);
  };
  /** @param {XmlNode} occ */
  const occurrenceQuantity = (occ) => {
    const q = Number(attr(occ, "quantity") ?? userValues(occ).Quantity ?? userValues(occ).quantity ?? 1);
    return Number.isFinite(q) && q > 0 ? q : 1;
  };
  /** @param {XmlNode | undefined} occ */
  const occurrenceItem = (occ) => {
    const ref = (attr(occ, "instancedRef") ?? attr(occ, "partRef") ?? attr(occ, "processRef") ?? "").replace(/^#/, "");
    return itemKeyOf.get(ref);
  };

  /** @type {Array<{ from: string; to: string }>} */
  const consumes = [];
  let unresolved = 0;
  for (const { tag, el } of all) {
    if (tag === "Occurrence" || tag === "ProductOccurrence" || tag === "ProcessOccurrence") {
      const parentKey = occurrenceItem(el);
      if (!parentKey) {
        if (attr(el, "instancedRef")) unresolved++;
        continue;
      }
      for (const childId of refList(attr(el, "occurrenceRefs") ?? attr(el, "childRefs"))) {
        const c = byId.get(childId);
        const childKey = occurrenceItem(c);
        if (c && childKey) use(parentKey, childKey, occurrenceQuantity(c));
      }
      // Parts a process step uses (PMem: productInstanceRefs on a process occurrence).
      if (tag === "ProcessOccurrence") {
        for (const usedId of refList(attr(el, "productInstanceRefs"))) {
          const usedKey = occurrenceItem(byId.get(usedId));
          if (usedKey && usedKey !== parentKey) consumes.push({ from: parentKey, to: usedKey });
        }
      }
      // Occurrences that name their parent instead of listing children.
      const parentOcc = byId.get((attr(el, "parentRef") ?? "").replace(/^#/, ""));
      if (parentOcc && !refList(attr(parentOcc, "occurrenceRefs") ?? attr(parentOcc, "childRefs")).includes(attr(el, "id") ?? "")) {
        use(occurrenceItem(parentOcc), parentKey, occurrenceQuantity(el));
      }
    } else if (attr(el, "instanceRefs") && itemKeyOf.has(attr(el, "id") ?? "")) {
      // InstanceGraph: a part lists the instances it is made of.
      const parentKey = itemKeyOf.get(attr(el, "id") ?? "");
      for (const instId of refList(attr(el, "instanceRefs"))) {
        const inst = byId.get(instId);
        if (inst && tagOf.get(inst) === "ProductInstance") use(parentKey, occurrenceItem(inst), occurrenceQuantity(inst));
      }
    }
  }
  if (unresolved) warnings.push(`${unresolved} occurrence(s) point at a revision that is not in the file; skipped`);

  // --- relations --------------------------------------------------------------
  /** @type {GraphDocumentEdge[]} */
  const links = [];
  let unknownRelations = 0;
  for (const { tag, el } of all) {
    if (tag !== "GeneralRelation" && tag !== "TraceabilityRelation" && tag !== "Relationship") continue;
    const ends = refList(attr(el, "relatedRefs") ?? `${attr(el, "source") ?? ""} ${attr(el, "target") ?? ""}`);
    const [a, b] = ends.map((r) => itemKeyOf.get(r));
    if (!a || !b) {
      unknownRelations++;
      continue;
    }
    const subType = attr(el, "subType") ?? attr(el, "type") ?? tag;
    const rel = RELATIONS[subType];
    const props = { subType, ...userValues(el) };
    if (!rel) {
      links.push({ from: a, to: b, type: EDGE_TYPES.LINKED_TO, properties: props });
    } else if (rel.type === EDGE_TYPES.SATISFIES) {
      // SAINT's SATISFIES runs item → requirement; Seg0Satisfy lists the requirement first.
      links.push({ from: b, to: a, type: rel.type, properties: props });
    } else if (rel.type === EDGE_TYPES.CHANGE_AFFECTS) {
      links.push({ from: a, to: b, type: rel.type, properties: { ...props, role: rel.role } });
    } else {
      links.push({ from: a, to: b, type: rel.type, properties: props });
    }
  }
  if (unknownRelations) warnings.push(`${unknownRelations} relation(s) name objects that are not in the file; skipped`);

  // --- document -----------------------------------------------------------------
  /** @type {GraphDocumentNode[]} */
  const nodes = [];
  for (const item of items.values()) {
    const cls = classify(item.subType) ?? (PROCESS_TAGS.has(item.tag) ? { className: CLASSES.PROCESS, layer: /** @type {const} */ ("P") } : null);
    const revisions = [...new Set(item.revisions)].sort(compareRevision);
    nodes.push({
      key: item.key,
      name: item.name,
      className: cls?.className ?? (/Requirement/.test(item.tag) ? CLASSES.REQUIREMENT : /Change/.test(item.tag) ? CLASSES.CHANGE_NOTICE : CLASSES.PART),
      sourceTag: item.subType ?? item.tag,
      rflpLayer: cls?.layer ?? (/Requirement/.test(item.tag) ? "R" : /^(Part|Product)/.test(item.tag) ? "P" : null),
      properties: {
        ...item.properties,
        ...(revisions.length ? { revision: revisions[revisions.length - 1] } : {}),
        ...(revisions.length > 1 ? { revisionsInFile: revisions.join(", ") } : {}),
      },
    });
  }
  /** @type {GraphDocumentEdge[]} */
  const edges = [
    ...[...usage].map(([k, quantity]) => {
      const [from, to] = k.split("|");
      return { from, to, type: EDGE_TYPES.HAS_CHILD, properties: { quantity } };
    }),
    ...links,
    ...docLinks.map((d) => ({ from: d.from, to: d.to, type: EDGE_TYPES.REFERENCES, properties: {} })),
    ...consumes.map((c) => ({ from: c.from, to: c.to, type: EDGE_TYPES.LINKED_TO, properties: { role: "consumes" } })),
  ];

  // Orient links by what their ends are, not by the order an exporter wrote
  // them in: a change link runs from the change, SATISFIES runs to the
  // requirement.
  const classOf = new Map(nodes.map((n) => [n.key, n.className]));
  const isChange = (/** @type {string} */ k) => classOf.get(k) === CLASSES.CHANGE_REQUEST || classOf.get(k) === CLASSES.CHANGE_NOTICE;
  for (const e of edges) {
    const flip =
      (e.type === EDGE_TYPES.CHANGE_AFFECTS && !isChange(e.from) && isChange(e.to)) ||
      (e.type === EDGE_TYPES.SATISFIES && classOf.get(e.to) !== CLASSES.REQUIREMENT && classOf.get(e.from) === CLASSES.REQUIREMENT);
    if (flip) [e.from, e.to] = [e.to, e.from];
  }

  // An unclassified item with children is an assembly.
  const parents = new Set(edges.filter((e) => e.type === EDGE_TYPES.HAS_CHILD).map((e) => e.from));
  for (const n of nodes) if (n.className === CLASSES.PART && parents.has(n.key)) n.className = CLASSES.ASSEMBLY;

  if (nodes.length === 0) warnings.push("No Product, Part, Requirement or Process elements found in this PLMXML file");
  return { document: { format: "PLMXML", name: docName, nodes, edges }, warnings };
}
