import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";
import { listRoles, listUsers, getUserStats } from "./services/user.service";
import { userViewSchema } from "./domain/validation";

/**
 * User-administration capabilities exposed to the AI layer.
 *
 * Read-only by design: creating users, granting roles and changing approval
 * limits are privilege operations that stay behind the admin UI. An agent can
 * tell you who approves what; it cannot change who approves what.
 */

export const lookupUsers = defineAgentTool({
  name: "user_admin_lookup_users",
  module: "user_admin",
  description:
    "Find platform users by name, user ID or email, returning their role, team and approval limit. " +
    "Use to answer 'who can approve this?' or to identify the right person to route an exception to.",
  permission: "user_admin:read",
  input: z.object({
    query: z.string().optional().describe("Name, user ID or email fragment; omit to list everyone"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.object({ users: z.array(userViewSchema) }),
  handler: async (input) => ({
    users: await listUsers({ q: input.query, limit: input.limit }),
  }),
});

export const describeRoles = defineAgentTool({
  name: "user_admin_describe_roles",
  module: "user_admin",
  description:
    "List the procurement roles with their permissions and delegation-of-authority limits. Use when " +
    "reasoning about whether a purchase needs escalation, or which role is required for an action.",
  permission: "user_admin:read",
  input: z.object({}),
  output: z.object({
    roles: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        permissions: z.array(z.string()),
        approvalLimit: z.number().nullable(),
      })
    ),
  }),
  handler: async () => {
    const rows = await listRoles();
    return {
      roles: rows.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        approvalLimit: r.approvalLimit,
      })),
    };
  },
});

export const userBaseStats = defineAgentTool({
  name: "user_admin_stats",
  module: "user_admin",
  description: "Counts of platform users by account state (total, active, suspended).",
  permission: "user_admin:read",
  input: z.object({}),
  output: z.object({ total: z.number(), active: z.number(), suspended: z.number() }),
  handler: async () => getUserStats(),
});

export const userAdminAgentTools: AgentToolDefinition[] = [
  lookupUsers,
  describeRoles,
  userBaseStats,
] as unknown as AgentToolDefinition[];
