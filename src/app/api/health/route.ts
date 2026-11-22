import { withRoute, ok } from "@/core/http";
import { getSchemaStatus } from "@/core/db";
import { agentServiceHealth } from "@/modules/ai_agents";
import { pmemHealth } from "@/modules/product";

export const dynamic = "force-dynamic";

/** Liveness + dependency probe. Deliberately unauthenticated. */
export const GET = withRoute("health", async () => {
  const [agent, pmem, database] = await Promise.all([agentServiceHealth(), pmemHealth(), getSchemaStatus()]);
  return ok({
    // "degraded" when the database is behind this build: expect failures until it is migrated.
    status: database.reachable && database.pending === 0 ? "ok" : "degraded",
    service: "saint",
    modules: ["auth", "user_admin", "suppliers", "contracts", "spend", "reports", "product", "ai_agents"],
    dependencies: { database, agentService: agent, pmemService: pmem },
    timestamp: new Date().toISOString(),
  });
});
