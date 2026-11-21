import type { z } from "zod";
import { getEnv } from "@/core/config";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";

const log = createLogger("product.pmem");

/**
 * HTTP client for the PMem service (FastAPI over Neo4j, in `PMem/backend`).
 *
 * PMem has no authentication of its own, so SAINT is the gatekeeper: routes
 * and agent tools check `product:*` permissions before anything reaches this
 * client, and PMem must only be reachable from SAINT's network.
 *
 * Only PMem's read endpoints are called from here. Imports and admin
 * operations (schema cleanup, database reset) stay in PMem's own UI.
 */

const START_HINT = "Start it with: npm run pmem:dev";

/** Call PMem and validate the response at the boundary. */
export async function pmemRequest<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<z.output<S>> {
  const env = getEnv();
  const url = `${env.PMEM_SERVICE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(env.PMEM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw AppError.upstream(`PMem did not answer within ${env.PMEM_TIMEOUT_MS} ms (${path})`);
    }
    throw AppError.upstream(`PMem service unreachable at ${env.PMEM_SERVICE_URL}. ${START_HINT}`, {
      cause: e instanceof Error ? e.message : String(e),
    });
  }

  if (!res.ok) {
    // PMem's error bodies are generic ("An error occurred..."); the status and
    // path are what a support engineer needs.
    log.warn("PMem request failed", { path, status: res.status });
    throw AppError.upstream(`PMem returned ${res.status} for ${path}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw AppError.upstream(`PMem returned a non-JSON body for ${path}`);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    log.error("PMem response did not match the expected shape", {
      path,
      issues: parsed.error.flatten().fieldErrors,
    });
    throw AppError.upstream(`PMem returned an unexpected response for ${path}`);
  }
  return parsed.data;
}

/**
 * Liveness probe surfaced on the health endpoint.
 *
 * `/ready` answers 503 when PMem is up but cannot reach Neo4j, which is worth
 * telling apart from PMem being down altogether.
 */
export async function pmemHealth(): Promise<{ reachable: boolean; ready: boolean; status: number }> {
  try {
    const res = await fetch(`${getEnv().PMEM_SERVICE_URL}/ready`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return { reachable: true, ready: res.ok, status: res.status };
  } catch {
    return { reachable: false, ready: false, status: 0 };
  }
}
