# Headcount HQ — Architecture & Implementation Plan

> **Status: DRAFT FOR REVIEW.** No implementation code has been written. This plan
> exists to be reviewed and approved before any build work begins.

> **UPDATE (2026-06-19) — stack changed to zero-dependency built-ins.**
> To make the app trivially host-deployable (push to GitHub → run on a host, no
> local tooling) *and* fully testable in the build environment, the foundation was
> rebuilt on Node's standard library only: `node:http`, `node:sqlite`, and
> `node:crypto` — no Fastify/Kysely/npm packages, no build step, no native compile.
> The architecture below still holds (layering, RBAC/comp-visibility, phase plan,
> security goals); only the implementing libraries changed. Passwords use scrypt
> (node:crypto) rather than Argon2, and persistence uses node:sqlite behind a small
> storage module so it can be swapped later.

## 0. Decisions already locked

From the planning conversation:

| Decision | Choice |
|---|---|
| Who it serves now | **Single-tenant** (one company), but **structured to extend** to multi-tenant later |
| Where sensitive data lives | **Self-hosted** — you run it; no third-party data processor |
| Feature scope | **Functionality across all three phases** of the product roadmap |
| Account creation | **Both** — admin sets passwords *and* can send email invite links |

These four answers force one non-negotiable conclusion: this is a **real server-backed
web application** with server-side authentication, role-based access control, and a
database. The existing client-only `import-tool` cannot satisfy "password-protected,
multi-user, sensitive comp data" — anything enforced in the browser is bypassable.
The good news is the existing `headcount-lib.js` engine (mapping, normalization,
validation, roll-up) is already pure and environment-agnostic, so it ports to the
server unchanged and becomes the core of the import domain.

---

## 1. System architecture

A single deployable application the company runs on its own infrastructure (a VM,
a container host, or an on-prem box). One Docker image + one database file/instance.

```
                    ┌───────────────────────────────────────────────┐
   Browser  ⇄  HTTPS │  Reverse proxy (Caddy/Nginx, TLS)             │
                    │        │                                       │
                    │   ┌────▼─────────────────────────────────┐    │
                    │   │  App server (Node + TypeScript)       │    │
                    │   │   • Auth & sessions  • CSRF  • rate-  │    │
                    │   │     limit                              │    │
                    │   │   • AuthZ layer (RBAC + comp-          │    │
                    │   │     visibility)  ← single source      │    │
                    │   │   • Routes (pages + JSON API)         │    │
                    │   │   • Domain engine (import, comp,      │    │
                    │   │     rollup, runway, scenarios)        │    │
                    │   │   • Repositories (DB access)          │    │
                    │   └────┬──────────────────────────────────┘    │
                    │        │                                       │
                    │   ┌────▼──────────┐   ┌───────────────────┐    │
                    │   │  Database      │   │  Optional SMTP    │    │
                    │   │  (SQLite→PG)   │   │  (invite emails)  │    │
                    │   └───────────────┘   └───────────────────┘    │
                    └───────────────────────────────────────────────┘
```

**Component boundaries (enforced, not just suggested):**

- **Domain** — pure business logic (import/validation/normalization, roll-up, runway,
  scenario math, comp-band logic). No DB, no HTTP. Fully unit-testable. This is where
  the existing engine lives and grows.
- **Repositories** — the *only* layer that touches the database. Parameterized queries
  only.
- **AuthZ** — a *single* module that answers "can this user see/do X, and how much comp
  detail." Every route and every repository read funnels through it. Centralizing this
  is the most important security decision in the whole system (see §4).
- **Routes/controllers** — thin; translate HTTP ⇄ domain/repo calls. No business logic.
- **Auth** — sessions, password hashing, invites, CSRF, login rate-limiting.

This layering is the antidote to the #1 risk in a sensitive-data app: comp leaking
through some forgotten endpoint. If comp visibility is decided in one place, it can't
drift.

### Extension-ready toward multi-tenant

Every tenant-scoped table carries a `workspace_id` from day one (defaulted to a single
seeded workspace now). All repository reads are scoped by it. Going multi-tenant later
becomes "populate more workspaces + add tenant resolution middleware," not a rewrite.
We do **not** build tenant management UI, signup, or billing now — that's the wasted
effort we agreed to avoid.

---

## 2. Technology stack (recommended)

Chosen for "boring, correct, well-supported, easy to self-host," not novelty.

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript (Node 20+)** | Type safety matters for financial/auth code; reuses the existing JS engine directly |
| Web framework | **Fastify** | Fast, first-class schema validation, mature plugin ecosystem |
| Database | **SQLite (better-sqlite3)** now, **Postgres-ready** | Zero-ops single file for self-host; trivial to back up (copy a file) |
| Query layer | **Kysely** (typed query builder) | Explicit SQL (no magic), and portable SQLite↔Postgres for the multi-tenant future |
| Migrations | Kysely migrations | Versioned, reviewable schema changes |
| Password hashing | **Argon2id** | Current best practice for password storage |
| Sessions | Server-side, DB-backed, httpOnly + SameSite + Secure cookies | No JWT-in-localStorage foot-guns |
| Email (optional) | Nodemailer + SMTP (config-gated) | Invites work when SMTP is set; admin-set passwords work without it |
| Testing | **Vitest** (unit/integration) + **Playwright** (e2e) | Fast unit runner; real-browser e2e for critical flows |
| Packaging | **Docker + docker-compose**, `.env` config | One-command self-host; GitHub-ready |
| CI | GitHub Actions (lint + typecheck + test) | Gate every change on a green suite |

**One open stack decision — the frontend** (see §7, Decision A). The two viable paths
are server-rendered + htmx vs. a React SPA. My recommendation is server-rendered with
htmx and small isolated chart/org-chart components, because it keeps comp logic on the
server by default (more secure) and is materially less code to test and maintain.

---

## 3. Data model (core tables)

All tenant-scoped tables include `workspace_id`. Timestamps and `created_by` on
mutable records for audit.

- **users** — id, workspace_id, email, name, role, password_hash, status
  (active/disabled), must_change_password, last_login_at
- **sessions** — id, user_id, expires_at, user_agent/ip (for audit)
- **invites** — token (hashed), email, role, expires_at, accepted_at, created_by
- **departments** — id, workspace_id, name, parent_id (org hierarchy), manager_user_id
- **levels** — id, workspace_id, name/rank, comp_band_min, comp_band_max (per level, optionally per dept)
- **employees** — canonical roster (the existing schema: employee_id, name, department,
  job_title, manager, employee_type, employment_status, comp fields, annual_salary) +
  level_id, start_date
- **compensation** — *separated* sensitive table: employee_id → exact amount/unit/annual.
  Split out so the AuthZ layer can withhold it from non-Finance roles cleanly
- **hiring_requests** — role, department_id, level_id, target_start_month, type
  (net-new/backfill), justification, comp_band, status, requester_id, timestamps
- **request_status_history** — request_id, from_status, to_status, actor_id, note, at
  (the auditable "submitted → review → approved → filled" trail)
- **budget_envelopes** — department_id, period, amount, set_by (Phase 2)
- **scenarios** + **scenario_items** — named what-if plans; items are planned hires with
  ramp timing and cost (Phase 2)
- **financials** — cash balance, baseline monthly burn (inputs for runway math; Phase 2)
- **actuals** — plan-vs-actual snapshots (Phase 2)
- **audit_log** — actor_id, action, entity, before/after summary, at (sensitive-data
  hygiene; cheap to include from day one)
- **import_batches** — provenance of each import (file name, mapping used, counts) so
  imports are re-runnable and traceable

---

## 4. Roles, permissions & comp-visibility (server-enforced)

Straight from the vision doc's matrix, enforced in the single AuthZ module:

| Role | Can do | Sees | Comp detail |
|---|---|---|---|
| **Finance Admin / Owner** | Own the model, import data, configure workspace, manage seats, run scenarios | All departments | **Exact salaries** |
| **C-Suite** | Set department budget envelopes, approve the plan | All departments | **Totals & bands only** |
| **Department Manager** | Submit & track requests for own team | **Own department only** | **Bands only** |

Enforcement rules:

- Comp visibility is applied at the **repository/serialization boundary**, so exact
  salary never enters a response payload for a role that may not see it — it isn't
  hidden by CSS, it's never sent.
- Department managers are scoped to their `department_id` at the query level; they
  cannot enumerate other departments' people or requests.
- Every authorization decision is covered by tests asserting the **negative** case
  (e.g., "manager request for another dept's comp returns 403 / empty, never data").

---

## 5. Feature → phase mapping, and what is honestly buildable

You asked for all three phases. Most of it is fully buildable in a single-tenant
self-hosted app. **Two Phase 3 items are not** — and I won't fake them. Flagged below.

**Phase 1 — source of truth + intake (fully buildable):**
Self-serve workspace setup; auth + roles + comp-visibility; guided import with
validation (ported engine); structured hiring-request intake with status tracking;
roll-up dashboards; sensible templates/defaults.

**Phase 2 — the planning engine (fully buildable):**
Per-department budget envelopes; scenario / what-if modeling; burn & runway
(needs a cash-balance + burn settings screen); time-phased cost ramps; plan-vs-actuals;
board-ready exports (PDF/CSV).

**Phase 3 — sticky + integrated (mixed):**
- Org-chart visualization — **buildable.** ✅
- Audit history — **buildable** (in from day one). ✅
- HRIS / ATS / accounting **live integrations** — **NOT buildable blind.** ⚠️ Each
  (Workday, BambooHR, Greenhouse, QuickBooks…) needs that vendor's API, OAuth
  credentials, and often an approved partner app. What I *can* build now is a clean
  **pluggable import-adapter interface** plus file-based adapters (CSV/XLSX), so live
  connectors drop in later without rework. (Decision C.)
- Anonymized **cross-company benchmarking** — **NOT buildable now.** ⚠️ By definition it
  needs *many* tenants and a central aggregation service with minimum-cohort thresholds.
  That contradicts "single-tenant, self-hosted, data never leaves." What I *can* do is
  shape the schema so an anonymized opt-in export is feasible later. (Decision C.)

---

## 6. Security design (because this is comp data)

- Argon2id password hashing; never store or log plaintext.
- Server-side sessions in httpOnly + SameSite=Lax + Secure cookies; idle + absolute
  expiry; logout invalidates server-side.
- CSRF tokens on all state-changing requests.
- Login rate-limiting + temporary lockout; generic error messages (no user enumeration).
- Parameterized queries everywhere (Kysely) — no string-built SQL.
- Security headers (CSP, HSTS, X-Content-Type-Options, etc.).
- Secrets only via environment / `.env` (gitignored); `.env.example` documents them.
- AuthZ centralized (§4); comp withheld at serialization, not the UI.
- Audit log for sensitive actions (logins, comp views/exports, role changes, approvals).
- TLS expected at the proxy; README documents a Caddy reverse-proxy for automatic HTTPS.
- Optional later: TOTP 2FA for admins (noted, not in first build unless you want it).

---

## 7. Open decisions for your call

Presented in your review format — description, why it matters, options with
effort/risk/impact/maintenance, and my recommendation.

### Decision A — Frontend approach

*Why it matters:* drives security posture, code volume, and test surface for the
entire UI.

- **Option A1 — Server-rendered (Fastify + templates) + htmx, isolated JS for charts/org-chart.** *(Recommended)*
  - Effort: **Lower.** Risk: **Lower** (comp logic stays server-side by default).
    Impact: covers all dashboards/forms; heavy viz handled by contained components.
    Maintenance: **Low** — one codebase, no API/SPA duplication.
- **Option A2 — React SPA (Vite + TS) + JSON API.**
  - Effort: **Higher** (two layers). Risk: **Higher** (must guard every API endpoint
    against comp leakage; token/CSRF handling). Impact: richest interactivity.
    Maintenance: **Higher** (client + server + shared types).
- **Option A3 — Do nothing / keep client-only.** Not viable — fails the auth & sensitive-data requirement.

**My recommendation: A1.** For an internal, sensitive-data tool a server-rendered app is
more secure by default and far less code to test thoroughly, which matters given you
want strong test coverage. The genuinely interactive bits (scenario comparison, org
chart) become small, well-bounded client islands rather than a whole SPA.

### Decision B — Database now

- **Option B1 — SQLite now, Postgres-portable via Kysely.** *(Recommended)* Effort: low;
  Risk: low; zero-ops backups (copy a file); ample for one company's roster. Migrating
  to Postgres later is a config + connection change because the query layer is portable.
- **Option B2 — Postgres now.** Effort: higher (a DB service to run/back up); Risk:
  more moving parts to self-host; Impact: only matters at multi-tenant scale we're not
  building yet.

**My recommendation: B1.**

### Decision C — The two Phase 3 limits

*Why it matters:* I won't ship fake integrations or fake benchmarking; I want your
explicit call on the realistic substitute.

- **Option C1 — Build the adapter framework + file adapters now; document live
  connectors and benchmarking as future work; shape schema to allow both later.** *(Recommended)*
  Effort: modest; Risk: low; Impact: real, extensible foundation; honest about scope.
- **Option C2 — Build one specific live integration now.** Requires you to name the
  vendor and provide API credentials / a sandbox; Effort: high per connector; Risk:
  external dependency and partner approval.
- **Option C3 — Drop Phase 3 integration/benchmarking entirely for now**, keep org-chart
  + audit only.

**My recommendation: C1**, unless there's one specific system (e.g., your HRIS) you
want connected first — then tell me which and we scope C2 for that one.

---

## 8. Testing strategy

"Better too many tests than too few." Coverage plan:

- **Unit (Vitest):** the whole domain engine — comp parsing/normalization, unit
  annualization, validation rules, roll-up, runway math, scenario math, comp-band logic.
  These are pure and get exhaustive edge-case tests (the existing engine's planted-error
  sample becomes fixtures).
- **Integration (Vitest + Fastify inject):** auth flows (login, lockout, invite accept,
  password change), **RBAC negative tests** (each role blocked from what it must not
  see/do — especially comp), import end-to-end through the API, request status
  transitions, envelope/scenario CRUD.
- **E2E (Playwright):** the critical journeys — admin creates an account, user logs in,
  import a roster, manager submits a request, admin approves it, board export renders.
- **CI gate:** lint + typecheck + full unit/integration on every push; e2e on PRs.

---

## 9. Proposed repository structure

```
headcount-hq/
  README.md  LICENSE  .gitignore  .env.example
  docker-compose.yml  Dockerfile
  package.json  tsconfig.json  vitest.config.ts  playwright.config.ts
  .github/workflows/ci.yml
  src/
    domain/        # pure engine: import, comp, validation, rollup, runway, scenarios
    db/            # schema, migrations, kysely setup, repositories
    auth/          # sessions, password (argon2), invites, csrf, rate-limit
    authz/         # single RBAC + comp-visibility module
    routes/        # page + JSON routes (thin)
    web/           # templates + chart/org-chart components  (if Decision A1)
    server.ts
  tests/
    unit/  integration/  e2e/
  docs/
    ARCHITECTURE_PLAN.md   # this file
```

---

## 10. Proposed build sequence (gated on your approval)

Each milestone ends green (tests passing) and is a natural review checkpoint per your
workflow (Architecture → Code → Tests → Performance).

1. **M0 — Scaffold:** repo, TS/Fastify/Kysely/SQLite, Docker, CI, `.env.example`,
   migration runner, empty schema. *(No business logic; provable it boots & tests run.)*
2. **M1 — Auth & accounts:** users, sessions, Argon2, login/logout, admin account
   management, invite links (SMTP-optional), password change, CSRF, rate-limit, audit
   log. Full auth/RBAC test suite.
3. **M2 — Roster & guided import:** port the engine into `domain/`, persistence, the
   guided import wizard against real storage, the separated comp table + comp-visibility
   enforcement.
4. **M3 — Structured hiring requests:** intake form, validation, status workflow +
   history, manager/admin/C-suite views.
5. **M4 — Roll-up dashboards:** department & company roll-ups, utilization vs. envelopes,
   role-appropriate comp display.
6. **M5 — Planning engine (Phase 2):** budget envelopes, runway/burn, scenarios, ramps,
   plan-vs-actual, board exports.
7. **M6 — Phase 3 (per Decision C):** org chart, audit history UI, adapter framework +
   file adapters; live connectors / benchmarking documented as future.

I will **pause for your review** at the end of each milestone rather than building all
of it before you see anything.

---

## 11. What I need from you to start

1. Approve or adjust **Decisions A, B, C** (§7).
2. Confirm the **stack** (§2) or name a house preference (e.g., Python/Postgres).
3. Confirm you're happy for me to **begin at M0** and pause for review between milestones.

Nothing gets built until you say go.
