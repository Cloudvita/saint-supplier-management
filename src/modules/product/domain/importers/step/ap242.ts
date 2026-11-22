import { CLASSES, EDGE_TYPES } from "../../graph-model";
import type { GraphDocumentEdge, GraphDocumentNode } from "../../graph-document";
import type { ParsedImport } from "../tabular";
import { decodeStepString, including, num, ofType, parsePart21, ref, refs, str, type P21File } from "./part21";

/**
 * STEP AP242 (and AP203/AP214, which share the product structure) into the
 * product graph: what a buyer needs from a CAD file, not its geometry.
 *
 *   PRODUCT + formation          → a part, with part number and revision
 *   NEXT_ASSEMBLY_USAGE_OCCURRENCE → HAS_CHILD, with the quantity used
 *   PROPERTY_DEFINITION → REPRESENTATION → item
 *                                 → properties (Teamcenter DB_PART_*, user attributes)
 *   MATERIAL_DESIGNATION          → material
 *   PMI (semantic and graphical)  → counts, and the annotation texts
 *
 * Geometry and presentation entities are read (they are most of the file)
 * and ignored.
 */

/**
 * Teamcenter / NX names a STEP product "000684_B;1-Rotor Shaft Machined":
 * item id, revision, sequence, name. Some exports use "_" for the ";".
 */
export function splitTeamcenterName(raw: string): { partNumber: string; revision: string | null; name: string } | null {
  const m = /^([A-Za-z0-9.\-]+)_([A-Za-z0-9]{1,4})[;_](\d+)-(.+)$/.exec(raw.trim());
  return m ? { partNumber: m[1], revision: m[2], name: displayName(m[4]) } : null;
}

/** CAD names carry file-name underscores ("End Bell_Machined"); show them as spaces. */
export function displayName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Property definitions that are CAD validation checksums, not attributes of the part. */
const VALIDATION_PROPERTY = /validation property$/i;

/** Semantic PMI entity types, as (or within) instances. */
const SEMANTIC_PMI: Record<string, string> = {
  GEOMETRIC_TOLERANCE: "tolerances",
  FLATNESS_TOLERANCE: "tolerances",
  CIRCULAR_RUNOUT_TOLERANCE: "tolerances",
  TOTAL_RUNOUT_TOLERANCE: "tolerances",
  CYLINDRICITY_TOLERANCE: "tolerances",
  ROUNDNESS_TOLERANCE: "tolerances",
  PERPENDICULARITY_TOLERANCE: "tolerances",
  PARALLELISM_TOLERANCE: "tolerances",
  POSITION_TOLERANCE: "tolerances",
  CONCENTRICITY_TOLERANCE: "tolerances",
  SURFACE_PROFILE_TOLERANCE: "tolerances",
  LINE_PROFILE_TOLERANCE: "tolerances",
  ANGULARITY_TOLERANCE: "tolerances",
  SYMMETRY_TOLERANCE: "tolerances",
  STRAIGHTNESS_TOLERANCE: "tolerances",
  DIMENSIONAL_SIZE: "dimensions",
  DIMENSIONAL_LOCATION: "dimensions",
  ANGULAR_SIZE: "dimensions",
  ANGULAR_LOCATION: "dimensions",
  DATUM: "datums",
  DATUM_FEATURE: "datumFeatures",
};

/** Graphical PMI: annotations drawn on the model, with or without semantics behind them. */
const GRAPHICAL_PMI = [
  "TESSELLATED_ANNOTATION_OCCURRENCE",
  "ANNOTATION_OCCURRENCE",
  "ANNOTATION_CURVE_OCCURRENCE",
  "ANNOTATION_PLACEHOLDER_OCCURRENCE",
  "DRAUGHTING_ANNOTATION_OCCURRENCE",
];

/** How many PMI annotation texts are kept on a part. */
const MAX_PMI_NOTES = 20;

/**
 * CAx-IF "equivalent unicode string": the annotation's text, with its own
 * escapes (\X2\…\X0\ again, \w between fields of a feature control frame).
 */
function pmiText(raw: string): string {
  return decodeStepString(raw)
    .replace(/\\w/g, " ")
    .replace(/^FCF\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Product = {
  stepId: number;
  key: string;
  name: string;
  revision: string | null;
  description: string | null;
  properties: Record<string, unknown>;
};

function propertyValue(file: P21File, repId: number): string | number | null {
  const rep = file.entities.get(repId);
  if (!rep) return null;
  for (const itemId of refs(rep.params[0][1])) {
    const item = file.entities.get(itemId);
    if (!item) continue;
    const type = item.types[0];
    if (type === "DESCRIPTIVE_REPRESENTATION_ITEM") return str(item.params[0][1]);
    if (type === "MEASURE_REPRESENTATION_ITEM" || type === "VALUE_REPRESENTATION_ITEM") return num(item.params[0][1]);
  }
  return null;
}

export function stepToGraph(text: string, docName: string): ParsedImport {
  const file = parsePart21(text);
  const warnings: string[] = [];
  const e = (id: number | null) => (id === null ? undefined : file.entities.get(id));

  // --- products ---------------------------------------------------------------
  const products = new Map<number, Product>(); // by PRODUCT id
  for (const p of ofType(file, "PRODUCT")) {
    const id = str(p.params[0][0]) ?? "";
    const rawName = str(p.params[0][1]) || id;
    const split = splitTeamcenterName(id) ?? splitTeamcenterName(rawName);
    products.set(p.id, {
      stepId: p.id,
      key: split?.partNumber || id || `#${p.id}`,
      name: split?.name || rawName || id || `Product #${p.id}`,
      revision: split?.revision ?? null,
      description: str(p.params[0][2]) || null,
      properties: { stepProductId: id },
    });
  }
  if (products.size === 0) {
    return { document: { format: "STEP", name: docName, nodes: [], edges: [] }, warnings: ["No PRODUCT entities in this STEP file"] };
  }

  // Formation → product (its id is the revision); definition → formation.
  const formationProduct = new Map<number, number>();
  for (const f of including(file, ["PRODUCT_DEFINITION_FORMATION", "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE"])) {
    const params = f.params[f.types.findIndex((t) => t.startsWith("PRODUCT_DEFINITION_FORMATION"))];
    const productId = ref(params[2]);
    if (productId === null) continue;
    formationProduct.set(f.id, productId);
    const rev = str(params[0]);
    const product = products.get(productId);
    if (product && rev && !product.revision) product.revision = rev;
  }
  const definitionProduct = new Map<number, number>();
  for (const d of including(file, ["PRODUCT_DEFINITION"])) {
    const params = d.params[d.types.indexOf("PRODUCT_DEFINITION")];
    const productId = formationProduct.get(ref(params[2]) ?? -1);
    if (productId !== undefined) definitionProduct.set(d.id, productId);
  }

  // --- properties (user-defined attributes) -----------------------------------
  const propertyReps = new Map<number, number>(); // PROPERTY_DEFINITION → REPRESENTATION
  for (const pdr of ofType(file, "PROPERTY_DEFINITION_REPRESENTATION")) {
    const def = ref(pdr.params[0][0]);
    const rep = ref(pdr.params[0][1]);
    if (def !== null && rep !== null) propertyReps.set(def, rep);
  }
  for (const pd of ofType(file, "PROPERTY_DEFINITION")) {
    const name = str(pd.params[0][0]);
    if (!name || VALIDATION_PROPERTY.test(name)) continue;
    const productId = definitionProduct.get(ref(pd.params[0][2]) ?? -1);
    const repId = propertyReps.get(pd.id);
    if (productId === undefined || repId === undefined) continue;
    const value = propertyValue(file, repId);
    if (value !== null && value !== "") products.get(productId)!.properties[name] = value;
  }
  for (const m of ofType(file, "MATERIAL_DESIGNATION")) {
    const material = str(m.params[0][0]);
    for (const defId of refs(m.params[0][1])) {
      const productId = definitionProduct.get(defId);
      if (material && productId !== undefined) products.get(productId)!.properties.material = material;
    }
  }

  // Teamcenter attributes, when present, are the authoritative identity;
  // once absorbed they are not repeated as properties, nor are values that
  // only restate the part number or the raw product id.
  for (const p of products.values()) {
    const tc = p.properties;
    const take = (k: string) => {
      const v = tc[k];
      delete tc[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    p.key = take("DB_PART_NO") ?? p.key;
    p.revision = take("DB_PART_REV") ?? p.revision;
    const tcName = take("DB_PART_NAME");
    if (tcName) p.name = displayName(tcName);
    const id = tc.stepProductId;
    for (const k of ["DB_PART_DESC", "DB_PART_MFKID", "Name"]) {
      if (tc[k] === p.key || tc[k] === id) delete tc[k];
    }
    if (p.description === id || p.description === p.key || p.description === p.name) p.description = null;
    if (typeof tc.DB_PART_DESC === "string" && !p.description) p.description = take("DB_PART_DESC");
    if (typeof tc.DB_PART_TYPE === "string") tc.itemType = take("DB_PART_TYPE");
  }

  // --- assembly structure -------------------------------------------------------
  const usage = new Map<string, number>(); // "parent|child" → quantity
  for (const n of including(file, ["NEXT_ASSEMBLY_USAGE_OCCURRENCE"])) {
    const params = n.params[n.types.indexOf("NEXT_ASSEMBLY_USAGE_OCCURRENCE")];
    const parent = definitionProduct.get(ref(params[3]) ?? -1);
    const child = definitionProduct.get(ref(params[4]) ?? -1);
    if (parent === undefined || child === undefined) {
      warnings.push(`NEXT_ASSEMBLY_USAGE_OCCURRENCE #${n.id} links a product definition that is not in the file; skipped`);
      continue;
    }
    const k = `${parent}|${child}`;
    usage.set(k, (usage.get(k) ?? 0) + 1);
  }

  // --- PMI --------------------------------------------------------------------
  const pmi: Record<string, number> = {};
  for (const ent of file.entities.values()) {
    for (const t of ent.types) {
      const bucket = SEMANTIC_PMI[t];
      if (bucket) {
        pmi[bucket] = (pmi[bucket] ?? 0) + 1;
        break;
      }
    }
  }
  const annotations = including(file, GRAPHICAL_PMI).length;
  if (annotations) pmi.annotations = annotations;
  const notes = [
    ...new Set(
      ofType(file, "DESCRIPTIVE_REPRESENTATION_ITEM")
        .filter((d) => str(d.params[0][0]) === "equivalent unicode string")
        .map((d) => pmiText(str(d.params[0][1]) ?? ""))
        .filter((t) => /[\p{L}\p{N}]/u.test(t))
    ),
  ];

  // PMI belongs to a part's own model. In a file holding one part, that is
  // the part; in an assembly file, the top-level products carry it.
  const children = new Set([...usage.keys()].map((k) => Number(k.split("|")[1])));
  const pmiOwners = products.size === 1 ? [...products.keys()] : [...products.keys()].filter((id) => !children.has(id));
  for (const id of pmiOwners) {
    const props = products.get(id)!.properties;
    for (const [bucket, count] of Object.entries(pmi)) props[`pmi.${bucket}`] = count;
    if (notes.length) props["pmi.notes"] = notes.slice(0, MAX_PMI_NOTES).join("; ");
  }

  // --- document -----------------------------------------------------------------
  const nodes = new Map<string, GraphDocumentNode>();
  const keyOf = new Map<number, string>();
  for (const p of products.values()) {
    let key = p.key;
    if (nodes.has(key)) {
      warnings.push(`Two products share part number ${key} (#${p.stepId}); the second is kept as ${key}#${p.stepId}`);
      key = `${key}#${p.stepId}`;
    }
    keyOf.set(p.stepId, key);
    nodes.set(key, {
      key,
      name: p.name,
      className: CLASSES.PART,
      sourceTag: "PRODUCT",
      rflpLayer: "P",
      properties: {
        ...p.properties,
        ...(p.revision ? { revision: p.revision } : {}),
        ...(p.description && p.description !== p.name ? { description: p.description } : {}),
      },
    });
  }
  const edges: GraphDocumentEdge[] = [];
  for (const [k, quantity] of usage) {
    const [parent, child] = k.split("|").map(Number);
    edges.push({ from: keyOf.get(parent)!, to: keyOf.get(child)!, type: EDGE_TYPES.HAS_CHILD, properties: { quantity } });
    nodes.get(keyOf.get(parent)!)!.className = CLASSES.ASSEMBLY;
  }

  if (file.header.schema && !/AP2(03|14|42)|CONFIG_CONTROL|AUTOMOTIVE_DESIGN/i.test(file.header.schema)) {
    warnings.unshift(`Schema ${file.header.schema} is not AP203/AP214/AP242; product structure was read on a best-effort basis`);
  }
  return { document: { format: "STEP", name: docName, nodes: [...nodes.values()], edges }, warnings };
}
