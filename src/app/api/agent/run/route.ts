import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { AGENT_MODE_KEYS, runAgent } from "@/modules/ai_agents";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/agent/run — non-streaming agent turn. */
export const POST = withRoute("agent.run", async (req) => {
  const ctx = await requirePermission(req, "ai_agents:invoke");
  const body = await parseJson(
    req,
    z.object({
      prompt: z.string().min(1).max(8000),
      mode: z.enum(AGENT_MODE_KEYS as [string, ...string[]]).optional(),
    })
  );
  return ok(await runAgent({ prompt: body.prompt, mode: body.mode as never }, ctx));
});
