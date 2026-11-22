import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { extractOntologyTriples } from "@/modules/ai_agents";
import { addTriples, ontologySchema } from "@/modules/product";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const triple = z.object({
  source_id: z.string().trim().min(1).max(200),
  source_type: z.string().trim().min(1).max(40),
  relation: z.string().trim().min(1).max(40),
  target_id: z.string().trim().min(1).max(200),
  target_type: z.string().trim().min(1).max(40),
  properties: z.record(z.unknown()).optional(),
});

const bodySchema = z
  .object({
    documentName: z.string().trim().min(1).max(200),
    /** Document text: the agent service's LLM extracts triples from it. */
    text: z.string().min(1).max(200_000).optional(),
    /** Or triples already in the ontology's shape (no LLM involved). */
    triples: z.array(triple).min(1).max(500).optional(),
  })
  .refine((v) => Boolean(v.text) !== Boolean(v.triples), { message: "Give exactly one of text or triples" });

/**
 * POST /api/ontology-kg/ingest { documentName, text } | { documentName, triples }
 *
 * Adds a document's supply-network facts to the graph. Every triple is checked
 * against the ontology here, whatever the LLM produced; suppliers and contracts
 * must be existing SAINT records.
 */
export const POST = withRoute("ontology-kg.ingest", async (req) => {
  const ctx = await requirePermission(req, "product:write");
  const body = await parseJson(req, bodySchema);
  const triples = body.triples ?? (await extractOntologyTriples(body.text as string, ontologySchema(), ctx));
  const result = await addTriples(triples as Parameters<typeof addTriples>[0], {
    document: body.documentName,
    createdBy: ctx.userId,
  });
  return ok({ document: body.documentName, extracted: triples.length, ...result });
});
