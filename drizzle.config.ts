import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

/**
 * Match Next.js env precedence: `.env.local` overrides `.env`.
 *
 * Without this, `drizzle-kit` reads only `.env` and can silently target a
 * different database than `npm run dev` does — migrations appear to succeed
 * against a database the app never opens.
 */
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  schema: "./src/core/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  verbose: true,
  strict: true,
});
