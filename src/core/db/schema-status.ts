import { sql } from "drizzle-orm";
import journal from "../../../drizzle/meta/_journal.json";
import { getDb } from "./client";

export type SchemaStatus = {
  reachable: boolean;
  /** The newest migration this build of the code expects. */
  expected: string;
  /** The newest migration recorded in the database, or null if none is. */
  applied: string | null;
  /** Migrations the code has that the database does not. */
  pending: number;
};

const entries = journal.entries;
const expected = entries[entries.length - 1].tag;

/**
 * Whether the database has every migration this build ships with.
 *
 * Surfaced on the health check so a deploy that went out ahead of its
 * database shows up as `pending > 0` instead of as scattered 500s. Never
 * throws: an unreachable database is reported, not raised.
 */
export async function getSchemaStatus(timeoutMs = 3000): Promise<SchemaStatus> {
  const probe = (async () => {
    try {
      const rows = (await getDb().execute(
        sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`
      )) as unknown as Array<{ created_at: string | number }>;
      const last = rows[0] ? Number(rows[0].created_at) : null;
      const applied = last === null ? null : (entries.find((e) => e.when === last)?.tag ?? `unknown (${last})`);
      const pending = entries.filter((e) => last === null || e.when > last).length;
      return { reachable: true, expected, applied, pending };
    } catch (e) {
      // 42P01: no migrations table yet — reachable, but nothing recorded.
      const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
      if (code === "42P01") return { reachable: true, expected, applied: null, pending: entries.length };
      return { reachable: false, expected, applied: null, pending: entries.length };
    }
  })();

  const timeout = new Promise<SchemaStatus>((resolve) =>
    setTimeout(() => resolve({ reachable: false, expected, applied: null, pending: entries.length }), timeoutMs)
  );
  return Promise.race([probe, timeout]);
}
