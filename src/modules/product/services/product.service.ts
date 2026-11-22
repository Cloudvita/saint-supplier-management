import { AppError } from "@/core/errors";
import { bestNameMatch, toProductNode, type ProductLink, type ProductNode } from "../domain/graph";
import { CHANGE_CLASSES, EDGE_TYPES, PART_CLASSES, PROCESS_CLASSES, TRACE_EDGE_TYPES } from "../domain/graph-model";
import { impactScore, similarityScore, type ChangeImpact, type SimilarParts } from "../domain/impact";
import {
  assemblyAncestors,
  assemblySiblings,
  degrees,
  directLinks,
  findNodes,
  getNode,
  nodesInSameSources,
  reachableCount,
} from "./graph.repository";

/**
 * Product knowledge graph queries, over SAINT's own graph tables.
 *
 * The graph is built by importing engineering files; what SAINT adds on top
 * — which supplier makes which part — lives in `sourcing.service.ts`.
 */

/** How many name matches an analysis considers before picking the best one. */
const RESOLVE_CANDIDATES = 25;

/** Find parts, assemblies and other graph nodes by name or source id. */
export async function searchParts(input: {
  q: string;
  limit?: number;
}): Promise<{ parts: ProductNode[]; total: number }> {
  const q = input.q.trim();
  if (!q) throw AppError.badRequest("Search text is required");
  const parts = (await findNodes(q, input.limit ?? 10)).map(toProductNode);
  return { parts, total: parts.length };
}

/** A graph node by id, or null. */
export async function getPart(partId: string): Promise<ProductNode | null> {
  const node = await getNode(partId);
  return node ? toProductNode(node) : null;
}

/** What a part is directly connected to: assemblies, requirements, processes, documents. */
export async function getPartLinks(
  partId: string,
  limit = 50
): Promise<{ part: ProductNode; links: ProductLink[]; indirectCount: number }> {
  const node = await getNode(partId);
  if (!node) throw AppError.notFound(`Part ${partId}`);

  const [links, reachable] = await Promise.all([directLinks([partId], { limit }), reachableCount(partId)]);
  const direct = new Set(links.map((l) => l.node.id));
  return {
    part: toProductNode(node),
    links: links.map((l) => ({ relation: l.type, direction: l.direction, node: toProductNode(l.node) })),
    // Reachable within three hops but not directly linked.
    indirectCount: Math.max(reachable - direct.size, 0),
  };
}

/**
 * The best name match; when several nodes match equally well (the same part
 * imported from two files), the one with more links — the copy that sits in
 * an assembly rather than a stand-alone part file.
 */
async function bestConnectedMatch<T extends { id: string; name: string }>(name: string, candidates: T[]): Promise<T | null> {
  const best = bestNameMatch(name, candidates);
  if (!best) return null;
  const ties = candidates.filter((c) => c.name.toLowerCase() === best.name.toLowerCase());
  if (ties.length < 2) return best;
  const degree = await degrees(ties.map((t) => t.id));
  return ties.reduce((a, b) => ((degree.get(b.id) ?? 0) > (degree.get(a.id) ?? 0) ? b : a));
}

/** The best-matching change request / notice by name. */
async function resolveChange(name: string) {
  return bestConnectedMatch(name, await findNodes(name, RESOLVE_CANDIDATES, CHANGE_CLASSES));
}

/**
 * The best-matching part by name: parts and assemblies first, then any other
 * node that is not a change (a function, a document ...).
 */
async function resolvePartByName(name: string) {
  const part = await bestConnectedMatch(name, await findNodes(name, RESOLVE_CANDIDATES, PART_CLASSES));
  if (part) return part;
  const others = (await findNodes(name, RESOLVE_CANDIDATES)).filter((n) => !CHANGE_CLASSES.includes(n.className ?? ""));
  return bestConnectedMatch(name, others);
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
}

/**
 * What a design change touches, starting from a part ("what if this part
 * changes?") or, with `asChange`, from a change request / notice. Same method
 * as PMem's recommender: affected items via change links (or the part
 * itself), assemblies above them, requirements they satisfy, processes in the
 * same files, and their other trace links.
 */
export async function analyseChangeImpact(name: string, opts: { asChange?: boolean } = {}): Promise<ChangeImpact> {
  const start = opts.asChange ? await resolveChange(name) : await resolvePartByName(name);
  if (!start) {
    return {
      changeEntity: null,
      impactScore: 0,
      impactedParts: [],
      affectedAssemblies: [],
      affectedRequirements: [],
      affectedProcesses: [],
      traceLinks: [],
      message: `No ${opts.asChange ? "change request or notice" : "part"} found for '${name}'`,
    };
  }

  // From a change: the items it affects. From a part: the part itself. (PMem
  // also followed change links into a part, which listed the change request
  // that points at a part as one of that part's "impacted parts".)
  const changeLinks = opts.asChange
    ? (await directLinks([start.id], { types: [EDGE_TYPES.CHANGE_AFFECTS] })).filter((l) => l.direction === "out")
    : [];
  const impacted = changeLinks.length
    ? uniqueBy(changeLinks, (l) => l.node.id).map((l) => ({
        node: l.node,
        relation: (l.edgeProperties.role as string | undefined) ?? l.type,
      }))
    : [{ node: start, relation: "self" }];
  const impactedIds = impacted.map((i) => i.node.id);
  const nameOf = new Map(impacted.map((i) => [i.node.id, i.node.name]));

  const [ancestors, requirementLinks, processes, otherLinks] = await Promise.all([
    assemblyAncestors(impactedIds),
    directLinks(impactedIds, { types: [EDGE_TYPES.SATISFIES] }),
    nodesInSameSources(impacted.map((i) => i.node), { classNames: PROCESS_CLASSES }),
    directLinks(impactedIds, {
      // Assemblies and change links are counted above; everything else is a trace link.
      excludeTypes: [EDGE_TYPES.HAS_CHILD, EDGE_TYPES.CHANGE_AFFECTS, EDGE_TYPES.SATISFIES],
      limit: 50,
    }),
  ]);

  const affectedAssemblies = uniqueBy(ancestors, (a) => a.name).map((a) => ({
    assembly: a.name,
    depth: a.depth,
    viaPart: a.viaPart,
  }));
  const affectedRequirements = uniqueBy(
    requirementLinks.filter((l) => l.direction === "out"),
    (l) => l.node.name
  ).map((l) => ({
    name: l.node.name,
    catalogueId: ((l.node.properties as Record<string, unknown>).catalogueId as string | undefined) ?? null,
    linkedPart: nameOf.get(l.fromNodeId) ?? null,
  }));
  const affectedProcesses = uniqueBy(processes, (p) => p.name).map((p) => ({
    name: p.name,
    linkType: "same source file",
    sourceTag: p.sourceTag,
    viaPart: impacted.find((i) => i.node.sourceId === p.sourceId)?.node.name ?? null,
  }));
  const traceLinks = uniqueBy(otherLinks, (l) => l.node.name).map((l) => ({
    name: l.node.name,
    linkType: l.type,
    sourceTag: l.node.sourceTag,
    viaPart: nameOf.get(l.fromNodeId) ?? null,
  }));

  return {
    changeEntity: {
      name: start.name,
      sourceTag: start.sourceTag,
      revision: ((start.properties as Record<string, unknown>).revision as string | undefined) ?? null,
      id: start.id,
    },
    impactScore: impactScore({
      parts: impacted.length,
      assemblies: affectedAssemblies.length,
      requirements: affectedRequirements.length,
      processes: affectedProcesses.length,
      traceLinks: traceLinks.length,
    }),
    impactedParts: impacted.map((i) => ({
      name: i.node.name,
      sourceTag: i.node.sourceTag,
      relation: i.relation,
      className: i.node.className,
    })),
    affectedAssemblies,
    affectedRequirements,
    affectedProcesses,
    traceLinks,
    message: null,
  };
}

/** Parts that resemble this one — candidates for substitution or consolidated sourcing. */
export async function findSimilarParts(partName: string, limit = 5): Promise<SimilarParts> {
  const source = await resolvePartByName(partName);
  if (!source) return { sourcePart: null, similarParts: [], message: `Part '${partName}' not found` };

  const [sameFile, siblings, traced] = await Promise.all([
    nodesInSameSources([source]),
    assemblySiblings(source.id),
    directLinks([source.id], { types: TRACE_EDGE_TYPES }),
  ]);

  type Candidate = (typeof sameFile)[number] & { sharedAssembly: boolean; traceLinked: boolean };
  const candidates = new Map<string, Candidate>();
  for (const n of [...sameFile, ...siblings]) {
    candidates.set(n.id, { ...n, sharedAssembly: true, traceLinked: candidates.get(n.id)?.traceLinked ?? false });
  }
  for (const l of traced) {
    if (l.node.id === source.id) continue;
    const existing = candidates.get(l.node.id);
    candidates.set(l.node.id, { ...l.node, sharedAssembly: existing?.sharedAssembly ?? false, traceLinked: true });
  }

  const similarParts = [...candidates.values()]
    .map((c) => ({
      name: c.name,
      sourceTag: c.sourceTag,
      layer: c.rflpLayer,
      score: similarityScore(source, c),
      sharedAssembly: c.sharedAssembly,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  return {
    sourcePart: { name: source.name, sourceTag: source.sourceTag, layer: source.rflpLayer },
    similarParts,
    message: null,
  };
}
