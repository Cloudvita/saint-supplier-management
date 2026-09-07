import { AppError } from "@/core/errors";
import { getEnv } from "@/core/config";
import { anonymousContext, hasPermission, systemContext, type AuthContext } from "@/core/agent";
import { contextForUser, resolveSession } from "./services/auth.service";

/**
 * Turn an incoming request into a caller identity.
 *
 * Three ways in, in precedence order:
 *  1. `Authorization: Bearer <session token>` — a signed-in human.
 *  2. `X-Agent-Secret` matching AGENT_TOOL_SECRET — the Python agent service
 *     calling a module tool endpoint. It must also name the user it acts for
 *     via `X-Acting-User`, so an agent never gains authority of its own.
 *  3. Nothing — the anonymous context, which holds no permissions.
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const agentSecret = getEnv().AGENT_TOOL_SECRET;
  const presented = req.headers.get("x-agent-secret");

  if (agentSecret && presented) {
    if (presented !== agentSecret) throw AppError.unauthenticated("Invalid agent credentials");
    const actingUser = req.headers.get("x-acting-user");
    if (!actingUser) {
      throw AppError.badRequest("Agent calls must name the acting user via X-Acting-User");
    }
    if (actingUser === "system") return { ...systemContext, viaAgent: true };
    return { ...(await contextForUser(actingUser)), viaAgent: true };
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return resolveSession(header.slice(7).trim());
  }

  return anonymousContext;
}

/** Caller identity, or a 401 if there isn't one. */
export async function requireSession(req: Request): Promise<AuthContext> {
  const ctx = await getAuthContext(req);
  if (ctx.userId === "anonymous") throw AppError.unauthenticated();
  return ctx;
}

/** Caller identity, or a 401/403. The standard opening line of a guarded route. */
export async function requirePermission(req: Request, permission: string): Promise<AuthContext> {
  const ctx = await requireSession(req);
  if (!hasPermission(ctx, permission)) {
    throw AppError.forbidden(`This action requires the "${permission}" permission`);
  }
  return ctx;
}

/**
 * Authorise a scheduled batch call (EventBridge / GitHub Actions) with the
 * shared CRON_SECRET, returning the system context. When no secret is
 * configured the check is skipped, which keeps local development workable.
 */
export function requireCronSecret(req: Request): AuthContext {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return systemContext;
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    throw AppError.unauthenticated("Unauthorized");
  }
  return systemContext;
}
