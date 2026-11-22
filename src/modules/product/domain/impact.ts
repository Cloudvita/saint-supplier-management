/**
 * Change impact and part similarity: result shapes and scoring, as pure
 * functions. The weights are PMem's, unchanged, so scores read the same as
 * they did there.
 */

type Text = string | null;

export type ChangeImpact = {
  changeEntity: { name: string; sourceTag: Text; revision: Text; id: Text } | null;
  /** 0–100: how widely the change reaches. */
  impactScore: number;
  impactedParts: Array<{ name: string; sourceTag: Text; relation: Text; className: Text }>;
  affectedAssemblies: Array<{ assembly: string; depth: number; viaPart: Text }>;
  affectedRequirements: Array<{ name: string; catalogueId: Text; linkedPart: Text }>;
  affectedProcesses: Array<{ name: string; linkType: Text; sourceTag: Text; viaPart: Text }>;
  /** Other items the impacted parts are directly linked to (traceability, references ...). */
  traceLinks: Array<{ name: string; linkType: string; sourceTag: Text; viaPart: Text }>;
  message: Text;
};

/** Breadth of impact, capped per dimension (PMem's weights). */
export function impactScore(counts: {
  parts: number;
  assemblies: number;
  requirements: number;
  processes: number;
  traceLinks: number;
}): number {
  const score =
    Math.min(counts.parts * 10, 30) +
    Math.min(counts.assemblies * 5, 20) +
    Math.min(counts.requirements * 8, 20) +
    Math.min(counts.processes * 5, 15) +
    Math.min(counts.traceLinks * 5, 15);
  return Math.round(Math.min(score, 100) * 10) / 10;
}

export type SimilarParts = {
  sourcePart: { name: string; sourceTag: Text; layer: Text } | null;
  similarParts: Array<{
    name: string;
    sourceTag: Text;
    layer: Text;
    /** 0–100: source type 20, RFLP layer 15, shared assembly or file 30, trace link 20, name 15. */
    score: number;
    sharedAssembly: boolean;
  }>;
  message: Text;
};

const STOP_WORDS = new Set(["the", "a", "an", "of", "for", "and", "in", "to", "with", "on", "at", "by", "is", "rev", "revision"]);

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s_\-/]+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
  );
}

/** Keyword overlap of two names, 0–1 (Jaccard over non-stop-words). */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / new Set([...ta, ...tb]).size;
}

type Comparable = { name: string; sourceTag: Text; rflpLayer: Text };

export function similarityScore(
  source: Comparable,
  candidate: Comparable & { sharedAssembly: boolean; traceLinked: boolean }
): number {
  const sameSource = (source.sourceTag ?? "").toLowerCase() === (candidate.sourceTag ?? "").toLowerCase();
  const sameLayer = Boolean(source.rflpLayer && candidate.rflpLayer && source.rflpLayer === candidate.rflpLayer);
  const total =
    (sameSource ? 20 : 0) +
    (sameLayer ? 15 : 0) +
    (candidate.sharedAssembly ? 30 : 0) +
    (candidate.traceLinked ? 20 : 0) +
    nameSimilarity(source.name, candidate.name) * 15;
  return Math.round(Math.min(total, 100) * 10) / 10;
}
