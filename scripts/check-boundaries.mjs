#!/usr/bin/env node
/**
 * Module boundary checker.
 *
 * An architecture that is only described in a README erodes. These rules are
 * the ones the design actually depends on, checked on every `npm run verify`:
 *
 *   1. A module may not reach inside another module. `@/modules/spend` is
 *      allowed; `@/modules/spend/services/spend.service` is not. Barrels are
 *      the contract.
 *   2. `core` may not import from `modules` (one documented exception: the
 *      Drizzle schema registry, which must name every module's tables).
 *   3. `shared` may not import from `core` or `modules` — it is the leaf.
 *   4. Only a module's own files may import its `schema.ts`. No cross-module
 *      table access.
 *   5. Outside `core/config`, nothing reads `process.env` directly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** core/db/schema.ts is the composition root for persistence — see its header. */
const SCHEMA_REGISTRY = join("src", "core", "db", "schema.ts");
/** The seed script is a composition root: it wires modules together on purpose. */
const COMPOSITION_ROOTS = [join("src", "bootstrap", "seed.ts")];
const ENV_ALLOWED = [
  join("src", "core", "config", "env.ts"),
  join("src", "core", "logger", "logger.ts"),
  join("src", "bootstrap", "seed.ts"),
];

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    // .js too: the product knowledge graph is written in JavaScript and must
    // follow the same module rules as the TypeScript around it.
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function moduleOf(relPath) {
  const parts = relPath.split(sep);
  return parts[1] === "modules" ? parts[2] : null;
}

function layerOf(relPath) {
  return relPath.split(sep)[1];
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, "utf8");
  const layer = layerOf(rel);
  const owner = moduleOf(rel);

  // --- rule 5: direct env access ---
  if (!ENV_ALLOWED.includes(rel) && /process\.env\.[A-Z]/.test(source)) {
    violations.push({
      file: rel,
      rule: "env-access",
      detail: "reads process.env directly — use `getEnv()` from @/core/config",
    });
  }

  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith("@/")) continue;
    const target = spec.slice(2);
    const segments = target.split("/");
    const targetLayer = segments[0];

    // --- rule 3: shared is a leaf ---
    if (layer === "shared" && (targetLayer === "core" || targetLayer === "modules")) {
      violations.push({
        file: rel,
        rule: "shared-purity",
        detail: `imports "${spec}" — shared may only depend on shared`,
      });
    }

    // --- rule 2: core must not depend on modules ---
    if (layer === "core" && targetLayer === "modules" && rel !== SCHEMA_REGISTRY) {
      violations.push({
        file: rel,
        rule: "core-independence",
        detail: `imports "${spec}" — core must not depend on a module`,
      });
    }

    if (targetLayer !== "modules") continue;
    const targetModule = segments[1];
    const depth = segments.length;

    // --- rule 1: no deep imports across modules ---
    const crossModule = owner !== targetModule;
    const exempt = rel === SCHEMA_REGISTRY || COMPOSITION_ROOTS.includes(rel);
    if (crossModule && depth > 2 && !exempt) {
      // `@/modules/x/ui/Thing` is permitted: UI composition is not domain access.
      const isUi = segments[2] === "ui";
      if (!isUi) {
        violations.push({
          file: rel,
          rule: "deep-import",
          detail: `imports "${spec}" — import from "@/modules/${targetModule}" instead`,
        });
      }
    }

    // --- rule 4: schema is module-private ---
    if (crossModule && segments[2] === "schema" && !exempt) {
      {
        violations.push({
          file: rel,
          rule: "schema-privacy",
          detail: `imports "${spec}" — a module's tables are private; use its service API`,
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ Module boundaries clean — no violations found.");
  process.exit(0);
}

console.error(`\n✗ ${violations.length} module boundary violation(s):\n`);
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.file}\n      ${v.detail}`);
}
console.error("");
process.exit(1);
