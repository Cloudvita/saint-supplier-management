import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import {
  executeAgentTool,
  toManifestEntry,
  type AgentToolDefinition,
  type AgentToolManifestEntry,
  type AuthContext,
  type ModuleName,
} from "@/core/agent";
import { authAgentTools } from "@/modules/auth";
import { userAdminAgentTools } from "@/modules/user_admin";
import { supplierAgentTools } from "@/modules/suppliers";
import { contractAgentTools } from "@/modules/contracts";
import { spendAgentTools } from "@/modules/spend";
import { reportAgentTools } from "@/modules/reports";

const log = createLogger("ai_agents.registry");

/**
 * The tool registry — the one place the AI layer meets the business modules.
 *
 * This is the inversion that keeps `/ai-agents` decoupled: it does not know
 * what a supplier or a purchase order is. It collects whatever each module
 * chose to publish, and serves it. A new capability appears to every agent the
 * moment a module exports it; a new *module* costs exactly one line here.
 */
const MODULE_TOOLS: Record<string, AgentToolDefinition[]> = {
  auth: authAgentTools,
  user_admin: userAdminAgentTools,
  suppliers: supplierAgentTools,
  contracts: contractAgentTools,
  spend: spendAgentTools,
  reports: reportAgentTools,
};

let index: Map<string, AgentToolDefinition> | null = null;

function getIndex(): Map<string, AgentToolDefinition> {
  if (index) return index;
  const map = new Map<string, AgentToolDefinition>();
  for (const [module, tools] of Object.entries(MODULE_TOOLS)) {
    for (const tool of tools) {
      if (map.has(tool.name)) {
        // A duplicate name would make tool dispatch ambiguous for the model.
        throw new Error(
          `Duplicate agent tool name "${tool.name}" (declared in ${map.get(tool.name)?.module} and ${module})`
        );
      }
      map.set(tool.name, tool);
    }
  }
  log.info("tool registry built", { tools: map.size, modules: Object.keys(MODULE_TOOLS).length });
  index = map;
  return map;
}

export function listAgentTools(modules?: ModuleName[]): AgentToolDefinition[] {
  const all = [...getIndex().values()];
  return modules?.length ? all.filter((t) => modules.includes(t.module)) : all;
}

/**
 * The manifest the Python agent service fetches at startup.
 *
 * Tools the caller cannot use are filtered out rather than returned and
 * refused later — an agent should not be told about a capability it will only
 * be denied when it tries.
 */
export function buildToolManifest(
  ctx: AuthContext,
  modules?: ModuleName[]
): { tools: AgentToolManifestEntry[]; generatedAt: string } {
  const permitted = listAgentTools(modules).filter(
    (t) => !t.permission || ctx.permissions.includes("*") || hasScoped(ctx.permissions, t.permission)
  );
  return {
    tools: permitted.map(toManifestEntry),
    generatedAt: new Date().toISOString(),
  };
}

function hasScoped(permissions: string[], required: string): boolean {
  if (permissions.includes(required)) return true;
  const [scope] = required.split(":");
  return permissions.includes(`${scope}:*`);
}

export function getAgentTool(name: string): AgentToolDefinition {
  const tool = getIndex().get(name);
  if (!tool) throw AppError.notFound(`Agent tool "${name}"`);
  return tool;
}

/** Dispatch a tool call by name, with schema and permission enforcement. */
export async function invokeAgentTool(
  name: string,
  input: unknown,
  ctx: AuthContext
): Promise<unknown> {
  return executeAgentTool(getAgentTool(name), input, ctx);
}

/** Test seam — forces the registry to rebuild on next access. */
export function resetRegistry(): void {
  index = null;
}
