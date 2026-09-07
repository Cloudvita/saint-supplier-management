import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";

/**
 * `/auth` publishes exactly one tool, and it is introspective.
 *
 * Signing in, issuing sessions and enrolling factors are never agent-callable:
 * an agent acts *as* an already-authenticated user (see `guard.ts`), so giving
 * it the ability to authenticate would let it escalate beyond its caller. What
 * it may do is tell the user what they are currently allowed to do.
 */
export const whoAmI = defineAgentTool({
  name: "auth_who_am_i",
  module: "auth",
  description:
    "Return the identity, role and permission set of the user this conversation is acting for. Use " +
    "before advising on an action, to check whether the user is allowed to take it themselves.",
  input: z.object({}),
  output: z.object({
    userId: z.string(),
    displayName: z.string(),
    role: z.string(),
    permissions: z.array(z.string()),
  }),
  handler: async (_input, ctx) => ({
    userId: ctx.userId,
    displayName: ctx.displayName,
    role: ctx.role,
    permissions: ctx.permissions,
  }),
});

export const authAgentTools: AgentToolDefinition[] = [whoAmI] as unknown as AgentToolDefinition[];
