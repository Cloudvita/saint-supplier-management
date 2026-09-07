import { withRoute, ok } from "@/core/http";
import { agentServiceHealth } from "@/modules/ai_agents";

export const dynamic = "force-dynamic";

/** Liveness + dependency probe. Deliberately unauthenticated. */
export const GET = withRoute("health", async () => {
  const agent = await agentServiceHealth();
  return ok({
    status: "ok",
    service: "saint",
    modules: ["auth", "user_admin", "suppliers", "contracts", "spend", "reports", "ai_agents"],
    dependencies: { agentService: agent },
    timestamp: new Date().toISOString(),
  });
});
