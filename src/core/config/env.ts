import { z } from "zod";

/**
 * Single, validated view of process.env for the whole application.
 *
 * Modules never read `process.env` directly — they import `env` from
 * `@/core/config`. That keeps configuration a cross-cutting concern owned by
 * core, and makes every environment dependency discoverable in one file.
 *
 * Validation is lazy (on first access) rather than at import time: a build or
 * a `next lint` pass must not require a live DATABASE_URL.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- persistence ---
  // Optional here, asserted by the database client instead. A required
  // DATABASE_URL would make every consumer of `getEnv()` — including pure
  // functions like password hashing — depend on the database being configured.
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // --- aws ---
  AWS_REGION: z.string().default("us-east-1"),
  S3_W9_BUCKET: z.string().optional(),
  S3_CONTRACT_BUCKET: z.string().optional(),

  // --- market news ---
  NEWS_PROVIDER: z.enum(["mock", "newsapi", "rss"]).default("mock"),
  NEWS_API_KEY: z.string().optional(),
  NEWS_RSS_TEMPLATE: z.string().optional(),

  // --- alerting ---
  ALERT_FROM_EMAIL: z.string().optional(),
  DEFAULT_PROCUREMENT_MANAGER_EMAIL: z.string().optional(),

  // --- scheduled jobs ---
  CRON_SECRET: z.string().optional(),

  // --- ai agents (python langgraph service) ---
  AGENT_SERVICE_URL: z.string().default("http://127.0.0.1:8000"),
  /** Shared secret the agent service presents when calling module tool endpoints. */
  AGENT_TOOL_SECRET: z.string().optional(),

  // --- auth ---
  /** Server-side pepper mixed into password hashes. Required in production. */
  AUTH_PEPPER: z.string().default("saint-dev-pepper"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
})
  // An empty string in a .env file is "unset", not a value. Without this, a
  // present-but-blank var defeats every `.default()` below it.
  .transform((v) => v);

export type Env = z.infer<typeof envSchema>;

function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    out[k] = typeof v === "string" && v.trim() === "" ? undefined : v;
  }
  return out;
}

let cached: Env | null = null;

/** Validated environment. Throws a single aggregated error on misconfiguration. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(blankToUndefined(process.env));
  if (!parsed.success) {
    const issues = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([k, v]) => `  ${k}: ${(v ?? []).join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam — drops the memoised env so a test can re-read process.env. */
export function resetEnvCache(): void {
  cached = null;
}
