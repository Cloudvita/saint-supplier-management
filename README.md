# SAINT — Source-to-Procure Platform

A **modular monolith**: one Next.js application partitioned into eight domain modules with
enforced boundaries, plus a Python LangGraph service that runs the AI agents and the PMem
service that serves the product knowledge graph.

> **Architecture:** see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map, the
> boundary rules, and how the LangChain integration works.

## Modules

| Module | Owns |
|---|---|
| `/auth` | Credentials (scrypt), sessions, TOTP MFA, the request guard |
| `/user-admin` | RBAC, users, roles, team hierarchy, delegation-of-authority limits |
| `/suppliers` | Supplier master, W-9 intake, market-news risk monitoring, performance |
| `/contracts` | Lifecycle, metadata extraction, clause audit, renewals, e-signature |
| `/spend` | Requisitions, POs, goods receipts, invoices, budgets, 3-way match |
| `/reports` | Cross-module dashboards, metric pipeline, export engine (owns no tables) |
| `/product` | Product knowledge graph — part search, where-used, change impact — read from PMem; supplier ↔ part links and sole-source exposure |
| `/ai-agents` | Tool registry, mode routing, gateway to the LangGraph service |

Each module exposes exactly one public entry point (`index.ts`). Reaching past a barrel, or
importing another module's tables, fails `npm run verify`.

## What it does

| Capability | How |
|---|---|
| Manual supplier entry | Validated form (Zod) → `POST /api/suppliers` |
| W-9 upload + data extraction | S3 archive → **Amazon Textract** `AnalyzeDocument` (FORMS) → field mapper auto-fills the form |
| Public / Private classification | Radio selector; ticker symbol captured for listed companies |
| 10 most recent records on screen | Server-rendered table with expandable detail |
| Weekly / monthly market news | Pluggable news provider → keyword risk classifier → digest written into the supplier's Market News field |
| M&A / bankruptcy / dispute alerts | Classifier raises a `risk_alert`, emails the procurement manager via Amazon SES |
| Supply-risk impact | For each supplier with an open alert: the parts it is the only approved source of, and the open POs behind them (`/reports`, dashboard metric, `supply_risk` export) |
| Contract clause compliance | Deterministic audit; a contract missing GDPR / liability / termination-for-convenience cannot be sent for signature |
| Purchase controls | Budget headroom + delegation of authority + sole-source justification + approved source for a named part, enforced in `spend/domain/policy.ts` |
| Invoice three-way match | PO vs goods receipt vs invoice, with relative and absolute tolerance |
| Conversational AI | 25 tools across 6 modules, exposed to LangChain agents in four operational modes |

## Architecture

```
Browser
   │
   ▼
Next.js 15 (App Router)  ──►  AWS App Runner (container from ECR)
   │  server components + route handlers
   │
   ├──► Drizzle ORM ──► Amazon RDS for PostgreSQL   (supplier master, news, alerts)
   ├──► Amazon Textract                             (W-9 field extraction)
   ├──► Amazon S3                                   (W-9 archive, SSE-AES256)
   ├──► Amazon SES                                  (risk alert + signature email)
   ├──► News provider (mock | NewsAPI | RSS)        (market intelligence)
   └──► Python agent service (FastAPI + LangGraph)  (conversational AI, SSE)
            │  fetches the tool manifest from /api/agent/tools
            └► calls back into module tools as the acting user
```

**Why this stack:** one deployable unit, no separate API server to operate. Drizzle is a
thin, fully type-safe SQL layer with no engine binary, so the container image stays small
and cold starts stay fast. Everything runs on managed AWS services — no servers to patch.

## Local development

```bash
cp .env.example .env
docker compose up -d          # Postgres 16 on :5432
npm install
npm run db:migrate            # apply SQL migrations
npm run db:seed               # 10 demo suppliers
npm run dev                   # http://localhost:3000
```

Textract and SES calls need AWS credentials. Without them the app still runs — W-9
extraction returns a clear error and alerts are logged instead of emailed.

### Product knowledge graph (optional)

The `/product` module reads parts and assemblies from PMem, a separate Python service
in `PMem/backend` backed by Neo4j. SAINT runs without it; product routes and agent tools
then answer `502` with a hint to start it.

```bash
cd PMem/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# create PMem/backend/.env with NEO4J_URI, NEO4J_USER, NEO4J_PASS, NEO4J_DATABASE
cd ../..
npm run pmem:dev              # http://127.0.0.1:8100 (8000 is the agent service)
```

Load engineering files (STEP, XSD, XMI, PLMXML) through PMem's own UI in `PMem/frontend`.
PMem has no authentication: keep it on a network only SAINT can reach. After pulling
the product changes, run `npm run db:migrate` locally (Vercel production builds migrate automatically, see
below) and `npm run db:seed` once so
existing roles pick up `product:read` and `product:write`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (standalone output) |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (local development) |
| `npm run db:migrate:deploy` | The deploy-time migrator, forced on: adopts a database without a migration journal, takes a lock, applies pending migrations |
| `npm run db:push` | Push schema without a migration file (dev only) |
| `npm run db:seed` | Insert 10 demo suppliers |
| `npm run db:studio` | Drizzle Studio |
| `npm run typecheck` | `tsc --noEmit` |

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/suppliers?limit=10&q=&companyType=` | List suppliers (tax IDs masked) |
| `POST` | `/api/suppliers` | Create supplier |
| `GET` `PATCH` `DELETE` | `/api/suppliers/[id]` | Read / update / delete |
| `POST` | `/api/w9/extract` | multipart `file` → Textract → mapped W-9 fields |
| `POST` | `/api/news/preview` | Fetch + classify news for an unsaved company |
| `POST` | `/api/news/refresh` | `{supplierId}` one supplier, or `{cadence}` batch (Bearer `CRON_SECRET`) |
| `GET` `PATCH` | `/api/alerts` | List / update risk alerts |
| `GET` | `/api/product/parts?q=&limit=` | Search parts and assemblies in the product graph |
| `GET` | `/api/product/parts/[id]/links` | What a part is directly connected to (where-used) |
| `POST` | `/api/product/change-impact` | `{partName}` → parts, assemblies, requirements a change touches |
| `GET` | `/api/reports/supply-risk?supplierId=` | Sole-source parts and open POs at stake per supplier with an open risk alert, worst first |
| `GET` `POST` | `/api/product/parts/[id]/sources` | Suppliers that can make a part / link one `{partName, supplierId, status?, unitPrice?, leadTimeDays?}` |
| `PATCH` `DELETE` | `/api/product/sources/[id]` | Change a link's status or terms / remove it |
| `GET` | `/api/product/suppliers/[id]/parts` | Parts a supplier makes, flagging those where it is the only approved source |
| `GET` | `/api/health` | App Runner health check |

## Data model

`suppliers` → `w9_documents`, `market_news_items`, `risk_alerts` (all cascade on delete).
`part_sources` links a PMem graph part (`part_id`) to a supplier (`supplier_id`); neither is a
foreign key, so both are checked when a link is made. `requisitions` and `purchase_orders`
carry an optional `part_id` / `part_name` for the part being bought; a PO raised from a
requisition inherits its part.
Schema lives in `src/db/schema.ts`; migrations in `drizzle/`.

## Swapping the news provider

`src/lib/news/providers.ts` exposes a `NewsProvider` interface. Set `NEWS_PROVIDER`:

- `mock` (default) — deterministic demo feed, no key required
- `newsapi` — set `NEWS_API_KEY`
- `rss` — set `NEWS_RSS_TEMPLATE` (e.g. Google News RSS)

Classification lives separately in `src/lib/news/classifier.ts`, so you can later replace
the keyword rules with an LLM call without touching the providers.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full AWS + GitHub walkthrough.

**Vercel production builds migrate the database before building.** If a migration fails, the build
fails and the current deployment stays live, so code never goes out ahead of its schema. Preview
builds don't migrate. `/api/health` shows `dependencies.database.pending`. Migrations must be safe to
apply while the previous release is still serving; see "Schema changes ship with the code" in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security notes

- Tax IDs are never serialized to the browser — the server sends only a masked form.
- W-9 objects are written to S3 with SSE and are only retrievable via short-lived presigned URLs.
- No AWS keys in the container: App Runner supplies credentials through an instance role.
- There is no authentication layer yet — put the service behind Cognito, an ALB with OIDC,
  or your existing SSO before exposing it beyond a private network.
