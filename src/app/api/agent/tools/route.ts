import { withRoute, ok } from "@/core/http";
import type { ModuleName } from "@/core/agent";
import { getAuthContext } from "@/modules/auth";
import { buildToolManifest } from "@/modules/ai_agents";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/tools?modules=suppliers,contracts
 *
 * The manifest the Python agent service turns into LangChain StructuredTools.
 * Scoped to the caller's permissions, so an agent is never shown a capability
 * its acting user could not exercise.
 */
export const GET = withRoute("agent.tools.manifest", async (req) => {
  const ctx = await getAuthContext(req);
  const modulesParam = new URL(req.url).searchParams.get("modules");
  const modules = modulesParam
    ? (modulesParam.split(",").map((m) => m.trim()) as ModuleName[])
    : undefined;

  return ok(buildToolManifest(ctx, modules));
});
