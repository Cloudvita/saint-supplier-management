import { withRoute, ok } from "@/core/http";
import { getAuthContext } from "@/modules/auth";
import { invokeAgentTool } from "@/modules/ai_agents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ tool: string }> };

/**
 * POST /api/agent/tools/<tool_name>
 *
 * Executes one module tool on behalf of the acting user. Input and output are
 * both validated against the tool's declared Zod schemas, and the permission
 * the tool declares is checked before the handler runs — so the agent layer
 * cannot widen what its caller is allowed to do.
 */
export const POST = withRoute<Ctx>("agent.tools.invoke", async (req, { params }) => {
  const { tool } = await params;
  const ctx = await getAuthContext(req);
  const input = await req.json().catch(() => ({}));
  return ok({ tool, result: await invokeAgentTool(tool, input, ctx) });
});
