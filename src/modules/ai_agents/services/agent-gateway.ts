import { getEnv } from "@/core/config";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import type { AuthContext } from "@/core/agent";
import { AGENT_MODES, routeMode, type AgentMode } from "../domain/modes";

const log = createLogger("ai_agents.gateway");

/**
 * Client for the Python LangGraph service.
 *
 * The agent loop, the LLM providers and the graph state live there; this side
 * owns identity and the tool contract. Every call carries the acting user, so
 * the agent's authority is exactly the caller's authority — never more.
 */

export type AgentRunRequest = {
  prompt: string;
  mode?: AgentMode;
  /** Prior turns, oldest first. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

function agentHeaders(ctx: AuthContext): HeadersInit {
  const env = getEnv();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Acting-User": ctx.userId,
  };
  if (env.AGENT_TOOL_SECRET) headers["X-Agent-Secret"] = env.AGENT_TOOL_SECRET;
  return headers;
}

/** Resolve the mode for a prompt, honouring an explicit override. */
export function resolveMode(request: AgentRunRequest): AgentMode {
  return request.mode ?? routeMode(request.prompt);
}

/**
 * Stream an agent run as Server-Sent Events, proxied straight through.
 *
 * Returned as a `Response` rather than parsed: the token stream is the
 * product, and re-buffering it here would only add latency.
 */
export async function streamAgentRun(
  request: AgentRunRequest,
  ctx: AuthContext
): Promise<Response> {
  const mode = resolveMode(request);
  const url = `${getEnv().AGENT_SERVICE_URL}/agent/stream`;

  log.info("agent run", { mode, userId: ctx.userId });

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: agentHeaders(ctx),
      body: JSON.stringify({
        prompt: request.prompt,
        mode,
        history: request.history ?? [],
        modules: AGENT_MODES[mode].modules,
        actor: {
          user_id: ctx.userId,
          display_name: ctx.displayName,
          role: ctx.role,
          permissions: ctx.permissions,
        },
      }),
    });
  } catch (e) {
    throw AppError.upstream(
      `Agent service unreachable at ${url}. Start it with: cd backend && uvicorn saint_agents.main:app --port 8000`,
      { cause: e instanceof Error ? e.message : String(e) }
    );
  }

  if (!upstream.ok || !upstream.body) {
    throw AppError.upstream(`Agent service returned ${upstream.status}`);
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Agent-Mode": mode,
    },
  });
}

/** Non-streaming run, for scheduled jobs and tests. */
export async function runAgent(request: AgentRunRequest, ctx: AuthContext) {
  const mode = resolveMode(request);
  const res = await fetch(`${getEnv().AGENT_SERVICE_URL}/agent/run`, {
    method: "POST",
    headers: agentHeaders(ctx),
    body: JSON.stringify({
      prompt: request.prompt,
      mode,
      history: request.history ?? [],
      modules: AGENT_MODES[mode].modules,
      actor: {
        user_id: ctx.userId,
        display_name: ctx.displayName,
        role: ctx.role,
        permissions: ctx.permissions,
      },
    }),
  }).catch((e) => {
    throw AppError.upstream(`Agent service unreachable: ${e instanceof Error ? e.message : String(e)}`);
  });

  if (!res.ok) throw AppError.upstream(`Agent service returned ${res.status}`);
  return (await res.json()) as { mode: AgentMode; answer: string; toolCalls: unknown[] };
}

/** Liveness probe surfaced on the health endpoint. */
export async function agentServiceHealth() {
  try {
    const res = await fetch(`${getEnv().AGENT_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return { reachable: res.ok, status: res.status };
  } catch {
    return { reachable: false, status: 0 };
  }
}
