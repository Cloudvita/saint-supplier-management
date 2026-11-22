#!/usr/bin/env node
/**
 * Deploy-time database migration.
 *
 * Runs before `next build` (see the `build` script). On a Vercel production
 * build it brings the database up to the schema the code being built expects,
 * and fails the build if it cannot — Vercel then keeps the current deployment
 * live, so new code never goes out ahead of its database.
 *
 * Everywhere else (local builds, preview deployments, the Docker image) it is a
 * no-op unless MIGRATE_ON_BUILD=1, because a preview build must not migrate a
 * database that production is still serving.
 *
 *   1. Connects directly, not through a transaction pooler: migrations and the
 *      advisory lock below need a real session.
 *   2. Takes an advisory lock, so two projects building the same commit
 *      cannot apply a migration twice.
 *   3. Adopts a database created without Drizzle's migration journal (from a
 *      hand-run schema file or `db:push`) by recording the migrations whose
 *      changes are already present, instead of re-running them and failing.
 *   4. Applies whatever is still pending with Drizzle's own migrator.
 *
 * Run by hand with `npm run db:migrate:deploy` (forces it on).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const MIGRATIONS_FOLDER = "drizzle";
/** Arbitrary, fixed: every SAINT build contends for the same lock. */
const LOCK_KEY = 728_461_903;

const log = (msg) => console.log(`[migrate] ${msg}`);
const fail = (msg) => {
  console.error(`[migrate] FAILED: ${msg}`);
  process.exit(1);
};

/* ------------------------------ when to run ------------------------------ */

const forced = process.argv.includes("--force") || /^(1|true)$/i.test(process.env.MIGRATE_ON_BUILD ?? "");
const vercelEnv = process.env.VERCEL_ENV;

if (!forced && vercelEnv !== "production") {
  log(`skipped (${vercelEnv ? `Vercel ${vercelEnv} build` : "not a Vercel production build"}; set MIGRATE_ON_BUILD=1 to run)`);
  process.exit(0);
}

/* ---------------------------- connection target -------------------------- */

const configured = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!configured?.trim()) {
  fail("neither MIGRATION_DATABASE_URL nor DATABASE_URL is set; refusing to build code against an unknown schema");
}

/**
 * Turn a pooled URL into a direct one. An explicit MIGRATION_DATABASE_URL is
 * used as given.
 *   Neon:     ep-x-pooler.region.aws.neon.tech  ->  ep-x.region.aws.neon.tech
 *   Supabase: pooler port 6543 (transaction)    ->  5432 (session)
 */
function directUrl(raw) {
  const url = new URL(raw);
  if (process.env.MIGRATION_DATABASE_URL) return { url, note: "MIGRATION_DATABASE_URL" };
  if (url.hostname.includes("-pooler.")) {
    url.hostname = url.hostname.replace("-pooler.", ".");
    return { url, note: "DATABASE_URL, Neon pooler bypassed" };
  }
  if (url.port === "6543") {
    url.port = "5432";
    return { url, note: "DATABASE_URL, Supabase session port" };
  }
  return { url, note: "DATABASE_URL" };
}

const { url, note } = directUrl(configured);
const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
const sslMode = url.searchParams.get("sslmode");
const ssl = sslMode === "disable" ? undefined : sslMode || !loopback ? "require" : undefined;

log(`target ${url.hostname}:${url.port || 5432}${url.pathname} (${note})`);

const client = postgres(url.toString(), { max: 1, ssl, prepare: false, onnotice: () => {}, connect_timeout: 15 });

/* -------------------------------- baseline ------------------------------- */

/**
 * How to recognise, in a database with no journal, that a migration's changes
 * are already there. Only needed for migrations that existed before builds ran
 * them; every later one is recorded in the journal as it is applied, so a new
 * migration needs no entry here.
 */
const PRESENT = {
  "0000_futuristic_dreadnoughts": `select to_regclass('public.suppliers') is not null as present`,
  "0001_fuzzy_captain_america": `select exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'news_cadence' and e.enumlabel = 'DAILY') as present`,
  "0002_white_wildside": `select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'suppliers' and column_name = 'performance_score')
    and to_regclass('public.users') is not null as present`,
  "0003_part_sources": `select to_regclass('public.part_sources') is not null as present`,
  "0004_spend_part_links": `select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'purchase_orders' and column_name = 'part_id') as present`,
};

async function journalRows() {
  const [{ exists }] = await client`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!exists) return 0;
  const [{ n }] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return n;
}

/**
 * Record the migrations an un-journalled database already has, so the
 * migrator starts after them. Present migrations must form an unbroken prefix
 * of the journal: a gap means the schema matches no point in the history, and
 * guessing would risk applying a migration on top of half its own changes.
 */
async function adoptExistingSchema(migrations, tags) {
  const present = [];
  for (const tag of tags) {
    const probe = PRESENT[tag];
    const [{ present: has }] = probe ? await client.unsafe(probe) : [{ present: false }];
    present.push(has);
  }

  const firstMissing = present.indexOf(false);
  const prefix = firstMissing === -1 ? present.length : firstMissing;
  if (present.slice(prefix).some(Boolean)) {
    const summary = tags.map((t, i) => `${t}=${present[i] ? "present" : "missing"}`).join(", ");
    fail(`existing schema matches no single migration point (${summary}). Baseline it by hand before deploying.`);
  }
  if (prefix === 0) {
    log("no journal and no SAINT tables: treating as a new database");
    return;
  }

  await client`create schema if not exists drizzle`;
  await client`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  for (const m of migrations.slice(0, prefix)) {
    await client`insert into drizzle.__drizzle_migrations (hash, created_at) values (${m.hash}, ${m.folderMillis})`;
  }
  log(`adopted existing schema: recorded ${tags.slice(0, prefix).join(", ")} as already applied`);
}

/* ---------------------------------- run ---------------------------------- */

async function main() {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const journal = (await import("../drizzle/meta/_journal.json", { with: { type: "json" } })).default;
  const tags = journal.entries.map((e) => e.tag);
  if (tags.length !== migrations.length) fail("drizzle/meta/_journal.json and the .sql files disagree");

  log("waiting for migration lock");
  await client`select pg_advisory_lock(${LOCK_KEY})`;
  try {
    if ((await journalRows()) === 0) await adoptExistingSchema(migrations, tags);

    const before = await journalRows();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await journalRows();

    const [last] = await client`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
    const latest = migrations[migrations.length - 1];
    if (!last || Number(last.created_at) !== latest.folderMillis) {
      fail(`database is not at the latest migration (${tags[tags.length - 1]}) after migrating`);
    }
    log(after > before ? `applied ${after - before} migration(s); now at ${tags[tags.length - 1]}` : `already at ${tags[tags.length - 1]}`);
  } finally {
    await client`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
  }
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    await client.end({ timeout: 1 }).catch(() => {});
    // The driver's message names the failing statement; never print the URL.
    fail(e instanceof Error ? e.message : String(e));
  });
