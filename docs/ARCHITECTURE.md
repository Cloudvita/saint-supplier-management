# SAINT — Modular Monolith Architecture

SAINT is a **modular monolith**: one deployable Next.js application, partitioned
into eight domain modules with enforced boundaries, plus two Python services:
one runs the LangChain/LangGraph agents, the other (PMem) serves the product
knowledge graph from Neo4j.

One deployable, eight domains. The boundaries are real — they are checked on
every `npm run verify` — but there is no network hop between them, no
distributed transaction, and no service mesh to operate. When a module
genuinely needs to become a service, its barrel is already the interface.

---

## 1. Layout

```
saint-app/
├── src/
│   ├── core/                 # cross-cutting infrastructure
│   │   ├── config/           #   validated environment (the only process.env reader)
│   │   ├── db/               #   Drizzle client, schema registry, column builders
│   │   ├── errors/           #   AppError taxonomy → HTTP status mapping
│   │   ├── logger/           #   structured, scoped, auto-redacting logger
│   │   ├── http/             #   route wrapper, response envelope, body parsing
│   │   ├── events/           #   typed in-process domain event bus
│   │   ├── agent/            #   the agent-tool contract + Zod → JSON Schema
│   │   ├── aws/              #   S3, SES, Textract client adapters
│   │   └── documents/        #   domain-agnostic OCR / key-value extraction
│   │
│   ├── shared/               # leaf layer: types, pure utils, UI primitives
│   │
│   ├── modules/
│   │   ├── auth/             # credentials, sessions, MFA, request guard
│   │   ├── user_admin/       # RBAC, users, roles, teams, DOA limits
│   │   ├── suppliers/        # supplier master, W-9 intake, market risk
│   │   ├── contracts/        # lifecycle, clause audit, renewals, e-signature
│   │   ├── spend/            # requisitions, POs, receipts, invoices, budgets
│   │   ├── reports/          # cross-module dashboards, metrics, export engine
│   │   ├── product/          # product graph (via PMem), supplier ↔ part links
│   │   └── ai_agents/        # tool registry, mode routing, agent gateway
│   │
│   ├── bootstrap/            # composition root (seeding)
│   └── app/                  # Next.js routes — thin adapters only
│
├── backend/saint_agents/     # Python: LangGraph agents, prompts, LLM providers
├── PMem/                     # Python + React: engineering-file import, product graph API
└── scripts/check-boundaries.mjs
```

### Module anatomy

Every module has the same shape, so navigating an unfamiliar one is free:

```
modules/<name>/
├── index.ts        # the barrel — the module's ENTIRE public surface
├── schema.ts       # Drizzle tables this module owns (private)
├── domain/         # pure rules: validation, policy, classification
├── services/       # use cases; the only place that touches the database
├── agent-tools.ts  # LangChain tool declarations this module publishes
└── ui/             # module-owned React components (where applicable)
```

`domain/` is deliberately free of I/O. The three-way match, the clause audit,
the news classifier and the purchase-policy controls are all pure functions —
which is why they can be unit-tested without a database and quoted verbatim by
an AI agent.

---

## 2. The rules, and what enforces them

| # | Rule | Enforced by |
|---|---|---|
| 1 | A module may only import another module's **barrel**, never its internals | `check:boundaries` (`deep-import`) |
| 2 | A module's **tables are private**; cross-module data goes through service APIs or events | `check:boundaries` (`schema-privacy`) |
| 3 | `core` must not depend on `modules` | `check:boundaries` (`core-independence`) |
| 4 | `shared` is a leaf — it depends on nothing | `check:boundaries` (`shared-purity`) |
| 5 | Only `core/config` reads `process.env` | `check:boundaries` (`env-access`) |

```bash
npm run verify   # typecheck + boundary check
```

Two documented exceptions exist, both marked in the checker:

- **`core/db/schema.ts`** imports every module's tables. Drizzle's relational
  query API needs one object describing the whole database. It is the
  composition root for persistence, not core reaching into domains.
- **`bootstrap/seed.ts`** wires modules together on purpose — that is what a
  composition root is for.

### Dependency direction

```
app/  ──────────────► modules/  ──────────────► core/  ──────► shared/
(routes: thin)        (domain logic)            (infra)        (leaf)
                            │
                            └── module → module only via barrels + events
```

Nothing points back up. `core` never knows a supplier exists.

---

## 3. How modules talk to each other

**Synchronous — service APIs.** When one module needs an answer now:

```ts
// modules/spend/services/spend.service.ts
import { getActiveContractsForSupplier } from "@/modules/contracts";
```

`/spend` does not know what table a contract lives in, or that
`missing_clauses` is a JSONB column. It asks a question and gets an answer.

**Asynchronous — domain events.** When something happened that others may care
about, and the publisher should not wait or fail:

```ts
await publish("supplier.risk_alert_raised", { supplierId, alertId, severity, ... });
```

The bus (`core/events`) is typed by a central catalogue, dispatches in-process,
and swallows subscriber failures — a reporting side-effect can never fail a
supplier write. When SAINT is split into services, `publish` is the seam that
becomes a broker.

**`/reports` owns no tables at all.** Every figure is composed from other
modules' public APIs. That is the load-bearing demonstration of rule 2: the
one place most tempted to "just write a join across everything" doesn't.

---

## 4. The LangChain integration

The design goal: **adding an AI capability should be a change inside a business
module, not inside the AI engine.**

### Business modules declare; the engine composes

A module never imports LangChain. It declares what it can do, with Zod schemas
on both sides of the call:

```ts
// modules/spend/agent-tools.ts
export const checkPurchaseAllowed = defineAgentTool({
  name: "spend_check_purchase_policy",
  module: "spend",
  description: "Check a proposed purchase against budget, DOA and sole-source controls…",
  permission: "spend:read",
  input:  z.object({ amount: z.number().positive(), approverId: z.string(), … }),
  output: policyDecisionSchema.extend({ summary: z.string() }),
  handler: async (input) => evaluatePurchasePolicy(input),
});
```

`/ai-agents` collects those declarations and knows nothing else about the
domain:

```ts
// modules/ai_agents/services/registry.ts
const MODULE_TOOLS = { auth, user_admin, suppliers, contracts, spend, reports };
```

A new tool reaches every agent the moment a module exports it. A new *module*
costs one line.

### One schema, two languages

Zod is the single source of truth. It is serialised to JSON Schema
(`core/agent/json-schema.ts`), served at `GET /api/agent/tools`, and rebuilt as
a Pydantic model on the Python side (`tools/schema_builder.py`), which
LangChain uses to validate the model's tool call *before* it leaves the agent
process.

```
Zod (TypeScript)  ──►  JSON Schema  ──►  Pydantic  ──►  LangChain StructuredTool
   source of truth        the wire        validation       what the LLM sees
```

Both ends of every call are validated: input before the handler runs, output
before it reaches the model. Schema drift surfaces as a clean 422, not as a
plausible-looking wrong answer.

### Request flow

```
Browser
  │  POST /api/agent/stream          (session bearer token)
  ▼
Next.js  ─ requirePermission("ai_agents:invoke")
         ─ routeMode(prompt) → SOURCING_ADVISOR | BUYER_COPILOT |
                                ANALYTICS_ENGINE | CONTRACT_AUDITOR
         ─ proxy SSE ─────────────────────────────►  Python agent service
                                                       │ GET /api/agent/tools?modules=…
                                                       │   → manifest scoped to THIS user
                                                       │ build StructuredTools
                                                       │ LangGraph: reason ⇄ tools
                                                       │ POST /api/agent/tools/<name>
                                                       ▼   → module service → Postgres
         ◄──────────── SSE: start / tool_call / tool_result / message / done
```

### The agent has no authority of its own

Every call from Python carries `X-Acting-User` plus the shared
`X-Agent-Secret`. The Next.js guard resolves that to the user's real permission
set, and `executeAgentTool` checks the tool's declared permission before the
handler runs. An agent can do exactly what its user could do, and no more.

The manifest is also **filtered** by permission rather than returning
everything and refusing later — an analyst's agent is never told about tools it
would only be denied. In practice a read-only analyst sees 14 of 25 tools.

### Modes

Four operational modes, each with a bounded tool surface and its own prompt
(`ai_agents/domain/modes.ts`, `backend/saint_agents/prompts/modes.py`).
Narrowing the tool set is a correctness measure as much as a security one: an
agent answering a spend question does better with 17 relevant tools than with
all 25, and cannot wander into contract mutation on the way.

Routing is keyword-based and deterministic first, which keeps mode selection
fast and explainable; the graph re-reasons when that is ambiguous.

---

## 5. Governance controls

Three controls are enforced in code, not just in prompts — the prompt tells the
agent about them, but `domain/policy.ts` is what actually refuses:

1. **Budget + delegation of authority.** `issuePurchaseOrder` runs
   `checkPurchasePolicy` and throws on any BLOCK-level violation. There is no
   code path that writes a PO the controls would have refused.
2. **Sole-source justification.** A single-source award at or above the
   threshold without written justification is blocked.
3. **Mandatory clauses.** A contract missing data-privacy, limitation-of-
   liability or termination-for-convenience cannot be sent for signature
   (`requestSignatures` throws `POLICY_VIOLATION`).

Because these are pure functions, the rule that blocks a PO in the UI is
literally the same rule the agent quotes when asked "can I buy this?". They
cannot drift apart.

---

## 6. Running it

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL at minimum

npm run db:migrate                # apply migrations
npm run db:seed                   # roles, demo suppliers, an admin account
npm run dev                       # http://localhost:3000

# AI agents (separate process)
cd backend && ./venv/bin/uvicorn saint_agents.main:app --reload --port 8000
# or: npm run agent:dev
```

`npm run verify` before every commit.

The agent service is optional: the application runs without it, and
`/api/health` reports it as unreachable rather than failing.

---

## 7. Adding to the system

**A new capability in an existing module**
1. Add the rule to `domain/` (pure, testable).
2. Add the use case to `services/`.
3. Export it from `index.ts`.
4. If an agent should use it, declare it in `agent-tools.ts` — nothing else changes.

**A new module**
1. `mkdir src/modules/<name>/{domain,services}`
2. Write `schema.ts`, register it in `core/db/schema.ts` (both the `export *`
   and the `schema` object).
3. Write `index.ts` as the public barrel.
4. Add its tools to `MODULE_TOOLS` in `ai_agents/services/registry.ts`.
5. Add the module name to `ModuleName` in `core/agent/tool.ts`.
6. `npm run verify`.

**Never**: import another module's `schema.ts`, reach past a barrel, or read
`process.env` outside `core/config`. The checker will tell you, but the reason
is that each of those quietly converts a boundary into a dependency.
