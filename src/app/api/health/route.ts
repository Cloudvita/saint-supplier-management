import { withRoute, ok } from "@/core/http";
import { agentServiceHealth } from "@/modules/ai_agents";
import { pmemHealth } from "@/modules/product";

export const dynamic = "force-dynamic";

/** Liveness + dependency probe. Deliberately unauthenticated. */
export const GET = withRoute("health", async () => {
  const [agent, pmem] = await Promise.all([agentServiceHealth(), pmemHealth()]);
  return ok({
    status: "ok",
    service: "saint",
    modules: ["auth", "user_admin", "suppliers", "contracts", "spend", "reports", "product", "ai_agents"],
    dependencies: { agentService: agent, pmemService: pmem },
    timestamp: new Date().toISOString(),
  });
});
