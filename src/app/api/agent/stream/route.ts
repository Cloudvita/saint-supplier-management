import { z } from "zod";
import { withRoute, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { AGENT_MODE_KEYS, streamAgentRun } from "@/modules/ai_agents";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  prompt: z.string().min(1, "A prompt is required").max(8000),
  mode: z.enum(AGENT_MODE_KEYS as [string, ...string[]]).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(40)
    .optional(),
});

/** POST /api/agent/stream — Server-Sent Events from the LangGraph agent. */
export const POST = withRoute("agent.stream", async (req) => {
  const ctx = await requirePermission(req, "ai_agents:invoke");
  const body = await parseJson(req, bodySchema);
  return streamAgentRun(
    { prompt: body.prompt, mode: body.mode as never, history: body.history },
    ctx
  );
});
