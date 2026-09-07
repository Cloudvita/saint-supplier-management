import dns from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/core/config";
import { schema } from "./schema";

/**
 * Serverless hosts (Vercel/AWS Lambda) typically have no outbound IPv6 route.
 * On a dual-stack DB host (Neon, Supabase, RDS), Node's default resolver can
 * still hand back an AAAA record first, and the resulting connect attempt
 * can hang. Forcing IPv4-first resolution avoids that.
 */
dns.setDefaultResultOrder("ipv4first");

function createClient() {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env(.local) and fill it in."
    );
  }
  const connectionString = env.DATABASE_URL;

  /**
   * Decide TLS from the host, not from a substring match.
   *
   * A plain `includes("localhost")` test treats `127.0.0.1` and `::1` as
   * remote and forces `ssl: "require"` against a local Postgres that speaks no
   * TLS — which fails as an opaque `ECONNRESET` during the handshake. An
   * explicit `sslmode` in the URL always wins.
   */
  const parsed = new URL(connectionString);
  const sslMode = parsed.searchParams.get("sslmode");
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  const isRemote = !isLoopback;
  const ssl =
    sslMode === "disable" ? undefined : sslMode ? ("require" as const) : isRemote ? ("require" as const) : undefined;

  /**
   * One pooled client per process (reused across warm invocations via Node's
   * module cache — no manual globalThis cache, which risks colliding with an
   * unrelated `globalThis.sql` set by another package).
   * RDS/Neon/Supabase require TLS — postgres.js picks that up from
   * `?sslmode=require` in the URL. `prepare: false` is required when the
   * connection goes through a PgBouncer transaction-mode pooler (e.g.
   * Supabase's :6543 pooler), which doesn't support prepared statements;
   * harmless otherwise.
   */
  return postgres(connectionString, {
    max: env.DB_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl,
    prepare: !isRemote,
  });
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let instance: Database | null = null;

/**
 * Lazily-built database handle.
 *
 * Deliberately lazy: importing a module's service must not require a live
 * DATABASE_URL, so `next build` and unit tests that never touch persistence
 * keep working.
 */
export function getDb(): Database {
  if (!instance) instance = drizzle(createClient(), { schema });
  return instance;
}

/**
 * Ambient handle for call sites that read like `db.query.suppliers…`.
 * Property access is forwarded to the lazily-created instance.
 */
export const db: Database = new Proxy({} as Database, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});
