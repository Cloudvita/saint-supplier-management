import { AppError } from "@/core/errors";
import {
  matchedNodes,
  partNeighbourhood,
  pmemGraphRowsSchema,
  type ProductLink,
  type ProductNode,
} from "../domain/graph";
import {
  pmemChangeImpactSchema,
  pmemSimilarPartsSchema,
  type ChangeImpact,
  type SimilarParts,
} from "../domain/impact";
import { pmemRequest } from "./pmem-client";

/**
 * Product knowledge graph queries.
 *
 * Read-only by design: the graph is built by importing engineering files in
 * PMem. What SAINT adds on top — which supplier makes which part — lives in
 * `sourcing.service.ts`.
 */

/** Find parts, assemblies and other graph nodes by name, label or id. */
export async function searchParts(input: {
  q: string;
  limit?: number;
}): Promise<{ parts: ProductNode[]; total: number }> {
  const q = input.q.trim();
  if (!q) throw AppError.badRequest("Search text is required");

  const { results } = await pmemRequest("/graphfilter", pmemGraphRowsSchema, {
    method: "POST",
    body: { search: q },
  });
  const parts = matchedNodes(results, input.limit ?? 10);
  return { parts, total: parts.length };
}

/** What a part is directly connected to: assemblies, requirements, processes, documents. */
export async function getPartLinks(
  partId: string,
  limit = 50
): Promise<{ part: ProductNode; links: ProductLink[]; indirectCount: number }> {
  const { results } = await pmemRequest(
    `/graphtraverse/${encodeURIComponent(partId)}`,
    pmemGraphRowsSchema
  );
  const view = partNeighbourhood(results, partId, limit);
  // PMem returns no rows both for an unknown id and for a node with no
  // relationships, so an isolated part also reads as "not found" here.
  if (!view.part) throw AppError.notFound(`Part ${partId}`);
  return { part: view.part, links: view.links, indirectCount: view.indirectCount };
}

/** What a design change to this part would touch, as PMem scores it. */
export async function analyseChangeImpact(partName: string): Promise<ChangeImpact> {
  return pmemRequest("/recommendations/change-impact", pmemChangeImpactSchema, {
    method: "POST",
    body: { part_name: partName },
  });
}

/** Parts that resemble this one — candidates for substitution or consolidated sourcing. */
export async function findSimilarParts(partName: string, limit = 5): Promise<SimilarParts> {
  return pmemRequest("/recommendations/similar-parts", pmemSimilarPartsSchema, {
    method: "POST",
    body: { part_name: partName, top_n: limit },
  });
}
