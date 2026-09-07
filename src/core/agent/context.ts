/**
 * Who a tool call is acting as.
 *
 * An agent never gets ambient authority: the caller's identity and permission
 * set travel with every tool invocation, and `executeAgentTool` checks them.
 */
export type AuthContext = {
  userId: string;
  displayName: string;
  role: string;
  permissions: string[];
  /** Set when the call arrived through the agent service rather than the UI. */
  viaAgent?: boolean;
};

/** Unauthenticated context — holds no permissions, so every guarded tool fails closed. */
export const anonymousContext: AuthContext = {
  userId: "anonymous",
  displayName: "Anonymous",
  role: "NONE",
  permissions: [],
};

/**
 * Context for trusted server-side jobs (cron news scans, seeding). Carries the
 * wildcard permission; never construct one from a request.
 */
export const systemContext: AuthContext = {
  userId: "system",
  displayName: "SAINT System",
  role: "SYSTEM",
  permissions: ["*"],
};

/**
 * Permission check with wildcard support.
 *
 * Grants are either exact (`suppliers:write`), module-wide (`suppliers:*`) or
 * global (`*`). Matching lives in core because both the HTTP guard and the
 * agent tool runner need identical semantics.
 */
export function hasPermission(ctx: AuthContext, required: string): boolean {
  if (ctx.permissions.includes("*")) return true;
  if (ctx.permissions.includes(required)) return true;
  const [scope] = required.split(":");
  return ctx.permissions.includes(`${scope}:*`);
}
