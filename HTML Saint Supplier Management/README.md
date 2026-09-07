# SAINT Supplier Management — Static HTML Build

A full rebuild of the supplier management module using **plain HTML, CSS, and
vanilla JavaScript only** — no Node.js, no build step, no framework, no
server required. Open `index.html` (or serve the folder) and it runs
entirely in the browser.

## Launching it

Any of these work:

- **Double-click `index.html`** and open it directly in a browser.
- **Any static file server**, e.g. from this folder: `python3 -m http.server 8080`
  then visit `http://localhost:8080`.
- **Any static host** (GitHub Pages, Netlify, Vercel static, S3 + CloudFront,
  an nginx container, etc.) — just upload this folder as-is. There is nothing
  to build, install, or configure.

## What's here

```
index.html                    Page shell + the static Add Supplier / RFP Builder form markup
css/styles.css                 All styling (no external stylesheet/CDN dependency)
js/utils.js                    id generation, HTML escaping, debounce, deep clone
js/idb.js                       Tiny generic IndexedDB helper (open db, get/replace records)
js/validation.js                Field validation rules (mirrors the original Zod schema)
js/demo-data.js                 Seed suppliers + simulated market-news generators
js/store.js                     In-memory + IndexedDB data layer, pub/sub
js/components/alerts.js         Risk Alerts tab
js/components/form.js           Add Supplier tab
js/components/table.js          Suppliers tab (search/filter/expand)
js/components/genie.js          AI Genie tab (bulk simulated news scan)
js/ai/w9-bot.js                 Supplier AI Bot: parses a W-9 into reviewable field proposals
js/rfp/rfp-data.js              RFP seed vendors/parameters + mock RFP document generator
js/rfp/rfp-store.js             RFP tab's own in-memory + localStorage data layer, pub/sub
js/components/rfp.js            RFP tab: sub-tab wiring, mounts the 4 steps below
js/components/rfp-vendors.js    RFP Step 1: candidate vendor directory
js/components/rfp-builder.js    RFP Step 2: 10-question intake, generation, dispatch
js/components/rfp-eval.js       RFP Step 3: weighted scoring, ranking, comparison chart
js/components/rfp-dashboard.js  RFP Step 4: CPO KPI overview, registry, audit inspector
js/admin/admin-data.js          Roles, per-role permissions, DOA limits, SuperUser check
js/admin/admin-store.js         Admin tab's own localStorage data layer + session login state
js/components/admin.js          Admin tab: add/edit user form + roster (SuperUser-only)
js/contracts/contract-data.js   Contract vocabulary + the clause/risk review rules
js/contracts/contract-store.js  Contracts + the analyst -> manager approval workflow
js/components/contracts.js      Contracts tab: register, editor, review & approval drawer
js/spend/spend-store.js         Purchase orders raised against approved contracts
js/components/spend.js          Spend tab: PO creation, dispatch, lifecycle
js/components/reports.js        Reporting tab: cross-module KPIs, charts, spend detail
js/components/auth-gate.js      Whole-app login screen + session/logout chrome in the header
js/app.js                       Tab wiring + boots every component
```

## The six modules

| Module | Tab | What it does |
|---|---|---|
| **User Administration** | Admin | Create up to 10 users, assign one of six procurement roles. Each role carries a permission set and a delegation-of-authority ceiling (`js/admin/admin-data.js`). |
| **Supplier Management** | Add Supplier / Suppliers | Add, edit and remove suppliers. Upload a W-9 and the **Supplier AI Bot** proposes the metadata for human review. |
| **RFP** | RFP | Vendor directory → intake & dispatch → weighted evaluation → award and shortlist. |
| **Contract Management** | Contracts | Contract metadata, a quick review of the terms for missing mandatory clauses and non-standard risk, and a drafted-by-analyst / approved-by-manager workflow. |
| **Spend Management** | Spend | Raise a purchase order from an approved contract and send it to the supplier. |
| **Reporting** | Reports | Cross-module analytics: active suppliers, active contracts, total spend, spend by category, active POs. |

### How the modules interlock

The value of the chain is that each step gates the next, and the gates are
enforced in the stores rather than by hiding buttons:

```
Admin ──grants role/permissions──► every other module's guards
Suppliers ──supplier record──► Contracts ──only when APPROVED──► Spend (POs)
                                    │                              │
                                    └──────────► Reports ◄──────────┘
```

- A **Sourcing Analyst** may draft and submit a contract but not approve one.
- The **person who submitted** a contract cannot also approve it.
- A contract **missing a mandatory clause** (data privacy, limitation of
  liability, termination for convenience) cannot be approved at all.
- An approver cannot approve **above their delegation-of-authority limit**.
- A purchase order can only be raised against an **approved** contract, and
  the sum of its POs cannot exceed the contract value.

### The Supplier AI Bot (W-9 intake)

`js/ai/w9-bot.js` reads an uploaded W-9 and proposes supplier metadata. It is a
real parse, not a mock: it recovers text from PDF text-showing operators, form
field values and XMP metadata, then extracts the legal name, DBA name, tax
classification (from the line-3 checkbox), EIN/SSN, address, email and phone.

Two properties matter more than the extraction itself:

- **Every proposal carries a real confidence score** reflecting where the value
  came from — read verbatim, read with an assumption, or inferred from the
  filename. A scanned or compressed PDF yields low confidence and says so.
- **Nothing is applied without a human.** Proposals land in a review table
  where each row can be ticked, edited or rejected; only ticked rows reach the
  form. Low-confidence rows arrive unticked, so a person has to make a positive
  decision about them.

As with the RFP generator, there is no OCR service or LLM call — shipping an
API key in public JavaScript is not an option. See "Wiring a real backend"
below for replacing the parse with Textract or a model endpoint.

The **RFP** tab is ported from [RFPPILOT](https://github.com/Cloudvita/RFPPILOT), a
Streamlit prototype for the same 4-step RFP lifecycle (vendor directory → intake &
dispatch → response evaluation & scoring → CPO historical dashboard). It's a
self-contained sibling to the supplier-management tabs — its own store, own
localStorage keys (`saint.rfp.*`) — with one intentional bridge: RFP Step 1
(Vendor Directory) has an **"Import from Suppliers"** picker that lists every
supplier from the Suppliers tab and lets you pull selected ones in as
RFP-dispatchable vendors, using their contact name/email on file. A supplier
needs a contact email for this (RFP vendors require one to receive an RFP);
suppliers missing one show up disabled with a note to add it on the Suppliers
tab first. Each imported vendor is tagged with the source supplier's id so it
won't be offered for import twice, and its card in the roster shows a "from
Suppliers" badge. Imported vendors are otherwise ordinary RFP vendor records —
they show up in Step 2's dispatch checklist exactly like manually-added ones.

Everything attaches to a single global, `window.SAINT`, to avoid polluting
the global namespace while still working as plain `<script>` tags (no
bundler, no ES module CORS restrictions on `file://`).

## Data storage

Supplier and alert records live in **IndexedDB** (database `saint-supplier-db`,
via the tiny wrapper in `js/idb.js`), not `localStorage`. There is no backend
and no network call in this build — refreshing the page keeps your data;
clearing site data (or using a private window) resets it back to the seeded
demo suppliers.

IndexedDB was chosen specifically for capacity: `localStorage` caps out at
roughly 5-10MB per origin (browser-dependent), which limits this app to
somewhere between a few hundred and a few thousand suppliers depending on how
much market-news text they carry. IndexedDB's quota is typically hundreds of
MB up to a few GB (browser- and disk-dependent), which is effectively
unlimited for a demo. `js/store.js` still keeps the working copy of the data
in an in-memory `Map()` (all reads/writes are synchronous from the UI's point
of view) and only the durability layer — writing to and reading from
IndexedDB — is async; UI components render once immediately and again
automatically once the initial IndexedDB read resolves, so no boot-sequencing
was needed elsewhere in the app.

If this browser previously ran an older version of this app that used
`localStorage` directly, that data is imported into IndexedDB automatically
the first time you load the page after upgrading, then the old `localStorage`
keys are cleared — nothing you'd already added gets silently dropped.

**Contracts** and **purchase orders** each own their own IndexedDB database
(`saint-contract-db` and `saint-spend-db`), through the same `js/idb.js`
helper. They are deliberately separate stores rather than extra object stores
in `saint-supplier-db`: each module owns its own persistence, and one module's
schema change cannot force a version bump on another's. They reference
suppliers and contracts by id and never read each other's records.

Because the demo seed for contracts needs real suppliers to attach to — and
purchase orders need an approved contract — each store awaits the one below it
(`SAINT.store.ready`, `SAINT.contractStore.ready`) before seeding. Nothing
else in the app needs boot sequencing.

The **RFP** tab still persists to `localStorage` (`saint.rfp.*` keys) — its
data volume (vendors, dispatched RFPs) is much smaller than supplier
records, so the same capacity pressure doesn't apply there today. It could
be moved onto the same `js/idb.js` helper later if that changes.

**Uploaded W-9 files are never stored at all**, in either `localStorage` or
IndexedDB. The Supplier AI Bot reads the file's bytes in memory to extract
field proposals and keeps only the file's name, type and size on the supplier
record — the document itself is never persisted, so it cannot be retrieved
later from this build.

**Security note on sensitive data:** the tax ID field is validated and then
immediately reduced to its last 4 digits (`taxIdLast4`) before anything is
stored — the full 9-digit value is never written to localStorage or held
onto after the save completes, mirroring the "mask before it ever reaches
storage" approach of the original server-rendered app.

## Login gate + user administration

The **whole app** now sits behind a login screen (`#auth-gate` in
`index.html`, driven by `js/components/auth-gate.js`) — nothing in the tab
bar or any panel is reachable until you log in. Two ways in:

- **SuperUser**: username `SuperUser`, password `SuperUser`.
- **Any user SuperUser has created**: their own User ID + password, assigned
  when the account was added (see below). If you don't have one yet, the
  login screen says to check with your admin — there's no self-service
  signup.

**This is a demo-only, client-side login gate — not real authentication.**
The credential checks live in `js/admin/admin-data.js` and
`js/admin/admin-store.js`, ship as public JavaScript, and can be read or
bypassed from the browser's dev tools in seconds. Passwords are also stored
in **plain text** — there's no backend to hash them against, and nothing
this static build could hash *with* even if it tried. All of this exists to
demonstrate the login/user-administration workflow, not to protect
anything. Real auth would need a backend (Clerk/Auth0/etc., same "static
pages can't hold secrets" constraint as every other backend-shaped feature
in this build) — worth doing before this is used for anything beyond a demo.

Once logged in, **only SuperUser** sees the Admin tab's user-management UI
(a regular logged-in user gets a "only SuperUser can add or edit users"
message on that tab, but still has full access to every other tab). SuperUser
can add up to **10 users**, each with First Name, Last Name, Department, a
Role (Sourcing Analyst, Sourcing Operations, Sourcing Lead, Sourcing
Manager, Chief Procurement Officer, Finance Lead), and now also a **User ID
and password** — the credentials that user logs into the app with. User IDs
must be unique and can't be `SuperUser` (reserved). One shared form handles
both adding and editing — clicking "Edit" on a roster card pre-fills the
form (password included, in plain text, so SuperUser can see and share it)
and switches it into edit mode; Submit saves, Cancel discards and returns to
add mode. There's no remove/delete action (not part of what was asked for)
— at 10 users, the form disables until an existing user is edited to free
up... nothing yet, since there's no delete. Say the word if removal should
be added.

The login session (who's currently logged in — SuperUser or which managed
user) lives in `sessionStorage`, so it survives a page refresh but not
closing the tab. The user roster itself persists in `localStorage` under
`saint.admin.users.v1` — a small, bounded dataset (≤10 records), so this
didn't need the IndexedDB treatment suppliers got.

The login screen also shows a simple capability diagram — Supplier
Management and RFP Management marked "Live," Contract Management,
Procurement, Market Intelligence, and Spend Reporting marked "Roadmap" — to
give first-time visitors a sense of what SAINT is meant to become, not just
what exists today.

## What's simulated (and why)

The original app called out to Amazon Textract (W-9 OCR), a live news API,
and Amazon SES (email alerts) — all of which need server-held credentials.
A static HTML page has nowhere secret to keep those credentials, so shipping
real calls to those services from the browser would mean embedding API keys
in public, readable JavaScript. Instead:

- **W-9 extraction** is a real parse, not a mock: the Supplier AI Bot
  (`js/ai/w9-bot.js`) reads the uploaded file's bytes and recovers text from
  PDF text operators, form field values and XMP metadata, then extracts the
  W-9 fields from it. What is *not* real is OCR — a scanned image or a
  compressed PDF stream cannot be read this way, and the bot says so and drops
  its confidence rather than pretending otherwise. Every proposal goes to a
  human review table before anything is applied.
- **Market news / risk events** are generated locally from a small phrase
  bank, seeded deterministically per company/day so repeated pulls in a demo
  don't feel random. Every digest is prefixed `SIMULATED MARKET BRIEF`.
- **Email notifications** are not sent; risk alerts are simply recorded and
  shown in the Risk Alerts tab.

- **Contract clause review** (`js/contracts/contract-data.js`) is a
  deterministic keyword rule set, not a model call. That is partly the same
  API-key constraint and partly deliberate: a finding that blocks a contract
  from being approved should be reproducible and explainable, and a named rule
  is both.

To wire in the real integrations, replace `generateNewsDigest` in
`js/demo-data.js` and the `recoverText`/extraction functions in
`js/ai/w9-bot.js` with `fetch()` calls to your own backend endpoints that hold
the actual AWS/news-API credentials — never call Textract, SES, or a paid news
API directly from browser code. The bot's return shape
(`{ proposals: [{ field, value, confidence, source }] }`) is what the review UI
depends on, so a Textract-backed implementation can drop straight in behind it.

The same applies to the **RFP** tab: RFPPILOT calls the Mistral API to expand
the 10-question intake into a formal document, with a documented fallback to
a template-based mock generator when no API key is configured. This build
only ever uses that fallback (`js/rfp/rfp-data.js`'s `generateMockRfp`) —
every generated document is clearly a template expansion, not an LLM call.
Wire a real backend endpoint there the same way if you need live generation.

## Design notes (best practices applied)

- **Data structures:** suppliers/alerts are kept in `Map()`s keyed by id for
  O(1) lookup instead of scanning arrays; a monotonically increasing
  counter (not `Array.length`) generates supplier codes so they stay stable
  even if deletion is added later.
- **Memory handling:** all list/table rendering uses **event delegation** —
  one listener per container, bound once at startup — instead of attaching
  a new listener to every row on every re-render, which is the most common
  source of DOM listener leaks in hand-rolled UI code. Debounced IndexedDB
  writes coalesce rapid mutations into a single transaction.
- **Security:** every piece of user-supplied text is passed through
  `escapeHtml()` before being interpolated into an HTML template string, a
  strict `Content-Security-Policy` meta tag blocks inline scripts and any
  network connection, and there are no `eval`/`Function`/`innerHTML`-with-
  raw-input call sites anywhere in the codebase.
- **Validation:** `js/validation.js` mirrors the original Zod schema's rules
  (required/optional fields, max lengths, email/ticker patterns, 9-digit tax
  ID) so data accepted here would also pass the original server schema.

## Accessibility / usability (IxDF-aligned pass, 2026-08-30)

An audit against Interaction Design Foundation-style usability heuristics
and WCAG AA found and fixed:

- **Contrast**: `.btn-primary`, the RFP intake character counters, and the
  footer text all failed WCAG AA (verified by computing actual contrast
  ratios from the CSS color tokens, not eyeballing it) — darkened to
  already-used-elsewhere compliant tokens.
- **Status announcements**: every flash/success/error message, the W-9
  upload status, and the Genie scan log now carry `role="status"
  aria-live="polite"`, so screen reader users are notified when an async
  action completes — previously all of that feedback was visual-only.
- **Destructive-action guard**: removing an RFP vendor now requires
  confirmation (was a single irreversible click).
- **Unlabeled controls**: the supplier search box, company-type filter, and
  W-9 file input relied on placeholder text/visual context only — added
  `aria-label`s.
- **ARIA tabs pattern**: the main tab bar and RFP sub-tab bar now implement
  the full ARIA APG "tabs, automatic activation" pattern — roving
  `tabindex`, Left/Right/Home/End keyboard navigation — via a shared
  `SAINT.utils.initAriaTabs()` helper instead of two separate hand-rolled
  (and keyboard-incomplete) implementations. The RFP Evaluation step's
  per-vendor pill "tabs" and the CPO Dashboard's audit-view buttons were
  switched from a misapplied `aria-selected` (invalid without a `role="tab"`
  container) to `aria-pressed`, which is what a plain toggle button should
  use — chosen over retrofitting the full tabs pattern onto widgets that are
  torn down and rebuilt on every re-render.
- **Focus visibility**: added a deliberate, consistent focus-visible outline
  for buttons/tabs/links, rather than relying on inconsistent browser/OS
  defaults (text inputs already had one via `.input:focus`).
