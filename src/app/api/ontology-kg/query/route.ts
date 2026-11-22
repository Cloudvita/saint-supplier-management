import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { answerFromGraph } from "@/modules/ai_agents";
import { graphContext, traceIndirectRisks } from "@/modules/product";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Focus the context (and trace risks) on one supplier: a SAINT id, code or name. */
  supplier: z.string().trim().min(1).max(200).optional(),
});

/**
 * POST /api/ontology-kg/query { question, supplier? } — Graph-RAG.
 * SAINT assembles the context (relationships, traced risk paths) from its own
 * graph; the agent service's LLM only phrases the answer from it.
 */
export const POST = withRoute("ontology-kg.query", async (req) => {
  const ctx = await requirePermission(req, "product:read");
  const { question, supplier } = await parseJson(req, bodySchema);
  const context = await graphContext(supplier);
  const trace = supplier ? await traceIndirectRisks(supplier) : null;
  const riskPaths = trace?.indirect_risks ?? [];
  const answer = await answerFromGraph(question, context, riskPaths, ctx);
  return ok({ question, answer, graph_context: context, risk_paths: riskPaths, exposed_parts: trace?.exposed_parts ?? null });
});
