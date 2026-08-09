# ERP Web Application Intelligence Audit (Prompt 1 of 102)

Audit date: 2026-08-08
Scope: `apps/web`, `services/api`, `database/*`, `packages/*` (the authenticated ERP product — not `apps/landing`, which is a separate marketing site with its own audit trail under `docs/landing-redesign/`).
Method: direct repository inspection + six parallel deep-dive research passes covering (1) stack/shell/UI system, (2) CRM/Sales/Accounting/Procurement, (3) Stock/Manufacturing/Projects/Assets/POS/Quality/Support/HR&Payroll, (4) shared platform capabilities, (5) auth/API/database architecture, (6) mock-data/test-reality/tech-debt. Every claim below is anchored to a file path; line numbers are given where the source agent captured them. No files were modified, no destructive commands were run, no migrations were executed.

---

## 1. Executive Summary

Vercentlabs ERP is a large, genuinely functional monorepo — not a prototype. All 12 modules (CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) have real frontend routes, real backend business logic operating on PostgreSQL with enforced Row-Level Security, and real relational schemas (300+ tables across `database/tenant/migrations`). Authentication, session management, RBAC (including time-bound and company/branch-scoped role assignments), maker-checker approval workflows, and a database-trigger-immutable audit trail are all implemented with production-grade rigor, not just documented.

The single most important finding of this audit is a direct contradiction inside the repository itself: **`README.md` states only CRM, Sales, Accounting and Procurement are "released," with the other 8 modules as unactivatable roadmap items — but `packages/shared-types/src/modules.js` marks all 12 modules `availability: "released"`, the activation gate in `apps/web/src/app/api/modules/[key]/route.ts` is consequently unreachable for any of the 8, and new organizations are seeded with all 12 modules enabled.** The README is stale, not the code. All 12 modules should be treated as real, shipped functionality — the 8 "roadmap" modules are less deep than the 4 "core" ones (thinner UI, no dedicated per-subsystem service files, no test coverage) but are not stubs.

The second most important finding is that this repository's entire verification/test safety net was deleted three days before this audit, in commit `90ee1c8` ("chore: remove legacy app checks and restore dependency patch," 2026-08-05), which removed 96 files / 13,334 lines — all of `apps/web/tests/`, all of `apps/web/scripts/`, `apps/mobile/tests/`, and `apps/landing`'s live-verification scripts — without touching a single `package.json`. As a direct result, roughly 80 of the ~140 scripts in the root `package.json` (every `verify:*`, most `test:*`, `db:migrate*`, `crm:jobs`/`crm:outbox`, `billing:*`) now point at files that do not exist. `apps/web` and `apps/mobile` currently have **zero** executable automated tests. No CI workflow ever exercised `apps/web`, `apps/mobile`, or `services/api` (`.github/workflows/` only contains landing-site workflows), which is why this went unnoticed. This is confirmed live: `pnpm test:web` and `pnpm test:api` both run and report `tests 0, pass 0, fail 0` (Section 20).

Third: a focused security pass found the codebase is **mostly** doing authorization correctly server-side (accounting, procurement, stock, manufacturing all re-check permissions inside the service layer, not just in the UI), but found three concrete, confirmed gaps: (a) three "sensitive field" permission keys (`hr_payroll.sensitive.view`, `support.sensitive.view`, `procurement.suppliers.sensitive`) are defined, assignable to roles, and referenced in role-conflict logic, but are **never checked anywhere in the codebase** — they do nothing; (b) CRM has no per-record ownership scoping despite role descriptions promising it ("Sales Representative — manage assigned leads"); any user with `crm.leads.manage` sees every lead in their company; (c) the public, unauthenticated CRM lead-capture endpoint has no rate limiting, unlike every other public/auth endpoint. See Section 12.

Fourth: the CSS/design layer is centralized and generally consistent (one `AppShell`, one nav config, one token system in `globals.css`), but CRM is a structural and visual outlier — it has two dedicated stylesheets that redefine the base radius/spacing token scale rather than reuse it, plus its own shell, resource manager, and kanban board components not shared with any other module.

Overall verdict: **evolve, do not rebuild.** The architecture, database design, RBAC model, and audit trail are strong and should be preserved. The immediate priorities before any new feature work are (1) restore or intentionally re-scope the deleted verification suite, (2) fix the README/product-scope narrative to match the code, (3) close the three confirmed security gaps, (4) consolidate the 3 duplicate generic resource-manager components and 2 duplicate pagination components identified in Section 15.

---

## 2. Technology Stack

| Layer | Finding |
|---|---|
| Package manager | pnpm `11.17.0` via corepack (`package.json:5`, `pnpm-workspace.yaml`) |
| Node runtime | `engines.node: ">=24 <25"` (`package.json:172`) — **currently running v26.5.0**, outside the declared range; every `pnpm` invocation prints `[WARN] Unsupported engine` (Section 20) |
| Monorepo tool | Turborepo (`turbo.json`) — `build`/`dev`/`lint`/`typecheck`/`test` pipelines, `dev` is `cache:false, persistent:true` |
| Web framework | Next.js `16.2.11`, App Router, `apps/web/package.json` |
| UI runtime | React `19.2.3` / React DOM `19.2.3` |
| Language | TypeScript `5.9.3` (`tsc --noEmit` is the typecheck script) |
| Validation | `zod ^4.1.12` — used consistently for form/route input validation (22+ files import it) |
| Styling | **No Tailwind, no CSS-in-JS.** Hand-rolled plain CSS with a CSS-custom-property token system in `apps/web/src/app/globals.css:5-62` (`--color-canvas`, `--color-primary`, `--radius-control`, `--shadow-panel`, `--sidebar-width`, etc.), fanned out across 10 stylesheets totaling ~15,000 lines, all loaded globally on every route via `apps/web/src/app/layout.tsx:3-9` and `globals.css:1-3` `@import`s. The `-extension.css` filenames (`crm-extension.css`, `sales-extension.css`, etc.) are misleading — they are real, load-bearing stylesheets, not stubs (two are only 2-3 lines but densely minified, not placeholders). |
| Forms | No form library (no react-hook-form/Formik). Plain controlled `<form>` + `useState` + a shared `requestJson()` fetch wrapper (`apps/web/src/lib/client-request.ts`) used by 27 client components. |
| State management | No Redux/Zustand/Jotai. Local `useState`/`useMemo` only. |
| Server-state/data fetching | No SWR/React Query. Pages are Server Components that call `@vercentlabs/api` functions directly inside `tenantTransaction()` at render time; client islands re-sync via `router.refresh()` after mutations. |
| Tables/grids | No table library. Hand-rolled `<table>` (16 files). Three parallel, near-duplicate generic CRUD managers exist instead of one canonical implementation: `resource-manager.tsx` (261 lines), `crm-resource-manager.tsx` (587 lines), `business-data-manager.tsx` (814 lines). |
| Charts | **None implemented.** No chart library is a dependency anywhere in the repo. "Dashboards" are KPI/metric-card and table layouts, not visualizations. |
| Dates | Native `Intl.DateTimeFormat`/`toLocaleDateString` — no date-fns/dayjs/moment/luxon dependency. |
| Icons | Hand-rolled inline-SVG icon set, `apps/web/src/components/app-icon.tsx`, single `AppIconName` union — no icon package dependency. |
| Theme | **Light-only.** `globals.css:6` sets `color-scheme: light`; no `prefers-color-scheme: dark` block, no theme toggle anywhere. |
| Responsive | Plain `@media (max-width:…)` breakpoints (620/720/961/1240px + reduced-motion/print) — no container queries. |
| Authentication | Cookie-based server sessions (not client JWT). Opaque random session tokens, SHA-256-hashed server-side, `httpOnly`/`sameSite=lax`/`secure`-in-prod cookie, `scrypt` password hashing with `timingSafeEqual` and a constant-time dummy-hash path to defeat user-enumeration timing attacks (`apps/web/src/lib/auth.ts`). |
| Authorization | Custom RBAC — see Section 12. |
| Server/client component ratio | Overwhelmingly server-first: only 1 of 122 `.tsx` files under `apps/web/src/app` is `"use client"` (`app/error.tsx`); interactivity is isolated to `apps/web/src/components/`, where 52 of 65 files are client islands. **No `middleware.ts` exists anywhere** — route protection is enforced by the shared `(app)/layout.tsx` server component calling `requireWorkspace()`, not by Next.js middleware. |
| Database | PostgreSQL 16 (`infrastructure/docker/compose.local.yml:2-3`, `postgres:16-alpine`) |
| DB access | Raw `pg` driver, no ORM. `packages/database` is a 16-line tenant-context-setting wrapper, not a query builder. Every service function hand-writes parameterized SQL. |
| Backend "API" | `services/api` is a **business-logic library**, not a standalone deployed service — no `start`/`dev` script, no express/fastify, `exports: "./src/index.js"`. It is imported directly by Next.js Server Components and Route Handlers and executed in-process against a `pg.PoolClient`. |
| Billing | Razorpay, real integration (checkout/verify/cancel/webhook routes, a documented billing state machine, and webhook-recovery migrations) — not a stub. |
| Mobile | Expo/React Native app at `apps/mobile` (out of scope for this audit but referenced where it shares code, e.g. billing, mobile sessions). |

---

## 3. Repository Architecture

```
apps/web        Next.js 16 ERP app. 534 TS/TSX files under src/. src/{app,components,lib}.
                 app/(app)/  — authenticated workspace, 22 top-level module/platform route groups
                 app/(auth)/ — login/signup/verification
                 app/api/    — Next.js Route Handlers (279 route.ts files)
apps/mobile      Expo/React Native. No tests/ directory currently exists (deleted, see Section 20)
apps/landing     Public marketing site. EXISTS and is actively developed (contradicts a stale claim
                 in CLAUDE.md that it was deleted/uncommitted — see Section 14 note).
services/api     Business-logic package, 37 .js/.d.ts files at top level plus 12 module subdirectories
                 (accounting, assets, crm, hr-payroll, manufacturing, point-of-sale, procurement,
                 projects, quality, sales, stock, support). Source is hand-authored ESM .js with
                 hand-written .d.ts — not a compiled/bundled output of a hidden TS tree.
database/
  control-plane/migrations   Identity, orgs, roles, sessions, billing, platform admin (public schema)
  control-plane/seeds
  tenant/migrations          52 files, per-module business schema (tenant.* schema, RLS-enforced)
  tenant/policies            README-only; RLS policies are actually defined inline per migration file
  tenant/functions           README-only; trigger functions are defined inline in the migrations
  tenant/seeds, tenant/views
packages/
  config             env-var validation (NOT a feature-flag system despite its own README's claim)
  database           16-line tenant-context (`set_config`) wrapper — no ORM
  document-engine, localization, observability, reporting-engine, workflows, permissions
  landing-content    marketing-copy source of truth, sourced live from shared-types module catalog
  shared-sdk         typed client wrappers (crm, accounting, billing, business-data, procurement, mobile)
  shared-types       cross-cutting contracts, INCLUDING the authoritative module-availability catalog
                      (packages/shared-types/src/modules.js) that contradicts README.md's scope claim
  shared-ui          3 unstyled primitives (StatusBadge, EmptyState, FieldError) — confirmed UNUSED
                      anywhere in apps/web/src (zero imports), not merely "minimal"
  test-utils
infrastructure/    Docker compose (local Postgres), Dockerfile.worker (targets a now-deleted script,
                   see Critical Bugs)
scripts/           DOES NOT EXIST — extensively referenced by root package.json, never present on disk
tests/             DOES NOT EXIST — extensively referenced by root package.json, never present on disk
```

Root `package.json` declares ~140 scripts; roughly 80 of them reference `scripts/` or `apps/web/scripts/`/`apps/web/tests/` paths that do not exist (Section 20). This is the single largest gap between "what the repo claims" and "what the repo does."

---

## 4. Existing Application Shell

Nearly the entire shell is one canonical component, `apps/web/src/components/app-shell.tsx` (1,139 lines):

- **Sidebar** — `app-shell.tsx:970-1027`.
- **Top bar** — `app-shell.tsx:1030-1110`.
- **Company/branch selector** — `apps/web/src/components/context-switcher.tsx`, one client component rendered once in the topbar, posts to `/api/context` and `/api/context/organization`; access is scoped by `membership_company_access`/`membership_branch_access` unless the user is an owner/system admin.
- **Global search** — `apps/web/src/components/workspace-search.tsx`, a plain `<input>` submitting `GET /search?q=`.
- **"Cmd/Ctrl+K" — is NOT a command palette.** It only calls `.focus()`/`.select()` on the search input (`workspace-search.tsx:10-21`). No overlay, no fuzzy match, no keyboard-navigable action list, no `cmdk`-style dependency anywhere in the repo.
- **Quick Create — does not exist.** No global "create any record" affordance anywhere in `components/` or `app/(app)`.
- **Notification bell** — `app-shell.tsx:1072-1087`, a link with an unread-count badge; **not a dropdown**, it navigates to the full `/notifications` page.
- **Settings shortcut** — reached via the sidebar's "Workspace settings" nav group, no separate topbar icon.
- **Profile/avatar menu** — link to `/profile` (initials avatar), shown in both sidebar and topbar; not a popover.
- **Mobile nav** — same `AppShell`, a `<details class="mobile-menu">` disclosure reusing the identical nav closure as desktop — genuinely one shared definition, not a duplicate.
- **Breadcrumbs** — `apps/web/src/components/breadcrumbs.tsx`, single implementation, but maintains its **own separate hardcoded label map** that duplicates labels already present in `app-shell.tsx`'s nav arrays — a second nav-adjacent data source that can drift.
- **Page title/header** — no shared `PageHeader` component; every `page.tsx` hand-rolls its own heading markup.

Duplication found: **none** in the shell itself (single `AppShell` feeds desktop/mobile/module-context-bar). The duplication risk is the breadcrumb label map vs. the nav config (Section 11), and the three parallel generic table/CRUD managers (Section 15).

---

## 5. Module Completion Matrix

| Module | Frontend | Backend | Database | Workflows | Analytics | Settings | Tests | Overall |
|---|---|---|---|---|---|---|---|---|
| CRM | 24 route groups, real server pagination/search/permission gating | 16 files, ~12,500 lines, real logic (rule-based "AI" scoring, hashing, permission checks) | ~200 tables across 22 migrations | `crm.activity.complete`, `crm.opportunity.stage_change` in shared workflow registry | KPI/table dashboards, no charts | `crm/settings` route | 1 thin SDK-URL contract test only | **A/B — Substantially implemented, most mature module** |
| Sales | 5 route groups, real dashboard + governance summary | 4 files but large (2,775+1,260+810 lines); 9-action order state machine | 28 tables, versioned (quotation/order versions, holds, amendments, events) | `sales.order.approve`, `.amendment.approve`, `.quotation.approve` | Table-based reports | `sales/settings` | **Zero tests at any layer** | **B — Substantially implemented** |
| Accounting | 10 route groups, real GL/payables/receivables/banking/close dashboards | 24 files, ~13,400 lines — largest service footprint; BigInt fixed-point decimal engine; hard-enforced double-entry balance check | 80 tables — GL, subledgers, banking, fixed assets, close, consolidation, tax | `accounting.journal/budget/customer_invoice/vendor_bill/vendor_payment.approve` | Table reports | `accounting/settings` | 1 thin SDK-URL contract test only | **A — Mature (relative), held back only by zero unit tests** |
| Procurement | 9 route groups, mostly thin wrappers around one 1,697-line client workspace component | Only 4 files; **generic CRUD dispatcher** over 11 resource types rather than per-resource governed functions | 39 tables, but base transactional tables store fields in an untyped `data jsonb` column, not typed columns (unlike Sales/Accounting) | No `procurement.*` commands in the shared workflow registry — approvals run through a separate `governance.js` | Table reports | `procurement/settings` | 1-line SDK contract test — thinnest of the four | **C — Partially implemented, weakest of the "core four"** |
| Stock/Warehouse | Real dashboard + resource pages | 239-line service; row-locked (`FOR UPDATE`) stock ledger, moving-average costing, atomic transfer completion | 9 tables, RLS-forced | Feeds Manufacturing & POS via FK | KPI dashboard | Generic settings | None | **B — Substantially implemented (contradicts README)** |
| Manufacturing | Real dashboard + BOM/work-order actions | 614-line service, largest of the 8 "roadmap" modules; guarded work-order lifecycle | 14 tables, FK's into stock_movements | BOM activation, WO release/start/production routes | KPI dashboard | Generic settings | None | **B — Substantially implemented (contradicts README)** |
| Projects | Real dashboard + dedicated `/profitability` route | 409-line service; live gross-margin computation | 13 tables incl. `project_profitability_snapshots` | Actions route | KPI dashboard | Generic settings | None | **B — Substantially implemented (contradicts README)** |
| Assets | Real dashboard + actions route | 457-line service; self-approval-blocked capitalize/dispose, gain/loss on disposal | 12 tables; FK into stock_movements for maintenance parts | Actions route | KPI dashboard | Generic settings | None | **B overall / C for inspections-transfers (documented as read-only, no create workflow)** |
| Point of Sale | Real dashboard + checkout/shift routes | 569-line service; checkout and stock deduction happen **in the same transaction**, idempotency key present, audit event fires | 13 tables, FK into stock_movements | Shift actions route | KPI dashboard | Generic settings | None | **B — Substantially implemented (contradicts README)** |
| Quality | Real dashboard + inspection actions | 471-line service; **hard-coded inspector/releaser segregation-of-duties check**, two row locks | 11 tables | Inspection actions route | KPI dashboard | Generic settings | None | **B — Substantially implemented (contradicts README)** |
| Support | Real dashboard + ticket/communications routes | 463-line service; SLA due-dates, resolution-code gate; escalation **data model exists but auto-trigger not wired** (documented gap) | 13 tables incl. escalation policy tables | Ticket actions route | KPI dashboard | Generic settings | None | **B overall / C for automated escalation specifically** |
| HR & Payroll | Real dashboard + leave/payroll actions | 534-line service, largest single index.js of the 8; **verified maker-checker** on leave and payroll approval (two distinct self-approval blocks), 3 row locks | 19 tables — largest schema of the 8 | Leave/payroll actions route | KPI dashboard | Generic settings | None | **B — Substantially implemented (contradicts README); only real gap is no GL-posting integration to Accounting** |

**Classification key**: A = Mature, B = Substantially implemented, C = Partially implemented, D = Skeleton/UI only, E = Missing. No module in this repository classifies as D or E — this is a materially more built-out product than the README's "four modules released, eight on the roadmap" framing suggests.

Structural pattern distinguishing the two groups: CRM/Sales/Accounting/Procurement have deep, multi-file UI trees (e.g., Accounting's `page.tsx` at 319 lines with 46 API route files); the 8 "roadmap" modules share one recurring shape — a single generic `[resource]/page.tsx` catch-all list view plus one dashboard component, backed by one `index.js` service file each. Shallower UI investment, yes; not stubs.

---

## 6. Shared Platform Completion Matrix

| Capability | Status | Evidence |
|---|---|---|
| **Home / Dashboard** | Implemented | `apps/web/src/app/(app)/dashboard/page.tsx` — org metrics, permission-filtered grid, open-activities panel, "Recent governance" panel from `audit_events` |
| **Master Data** | Implemented | `apps/web/src/app/(app)/master-data/**`, `apps/web/src/lib/business-data.ts` |
| **Notifications** | Implemented (basic) | `notifications/page.tsx` + `notification-list.tsx`, real `notifications` table; no categorization/preferences UI |
| **Approvals** | Implemented, real workflow engine | `approvals/page.tsx`, `approval-actions.tsx`, `packages/workflows/src/index.js` (SoD enforcement, optimistic locking) |
| **Tasks** | **Partial, no dedicated route** | Only a read-only "open activities" panel on the dashboard reading a shared `activities` table; no create/edit/complete UI or dedicated page |
| **Follow-ups & Reminders** | **Missing at platform level** | Exists only inside CRM (`crm_activities`, CRM-scoped components); no shared/platform feature |
| **Exceptions** | **Missing as a unified capability** | Exists only as module-local queues (procurement governance, accounting tax/banking operations, payables); no cross-module Exceptions inbox |
| **Recent Records** | **Missing** | No "recently viewed" concept anywhere; profile page only shows login history |
| **Favourites** | **Missing** | Zero matches for favourite/favorite anywhere; no pinning affordance in nav |
| **Billing** | Implemented, deep, real Razorpay | `billing/page.tsx`, `billing-workspace.tsx`, checkout/verify/cancel/webhook routes, explicit billing state machine + webhook-recovery migrations |
| **Audit Logs** | Implemented, **verified database-trigger-immutable** | `audit-logs/page.tsx` over `audit_events`; `prevent_audit_event_mutation()` trigger (`BEFORE UPDATE OR DELETE`) confirmed in `database/control-plane/migrations/002_platform_foundation.sql` |
| **Compliance** | **Missing as dedicated capability** | Only module-local (`accounting/compliance/requests`); no cross-module compliance dashboard |
| **Workspace Settings** | Implemented | `settings/**` — Organisation, Companies, Branches, Departments, Teams, Cost centres, Users, Roles & permissions, Numbering series. **No Integrations/Data Management/Reports/Automation entries here either.** |
| **Automation** | **Effectively missing** | `packages/workflows` is approval/state-machine plumbing (36 lines) — no rule builder, scheduler, or trigger mechanism |
| **Reports & Analytics** | **Missing as a unified surface** | Exists only per-module (`accounting/reports`, `sales/reports`, etc.); `packages/reporting-engine` is a real shared CSV/pagination primitive, but there is no top-level `/reports` |
| **Integrations** | **Missing** | No `integrations/` route; the only real "integration" is the inbound Razorpay webhook, which is a billing concern, not a general framework |
| **Data Management** | **Partial, fragmented** | Real import/export exists per-module (business-data, CRM, mobile) with shared CSV/formula-injection-guard plumbing (`apps/web/src/lib/csv.ts`) — no unified UI |
| **Security** | Implemented, but personal-account scope only | `security/page.tsx` — password change, session revocation; **explicitly admits in-page that MFA is schema-ready but not enforced**; no org-wide security-policy console |
| **Global Search** | Implemented, permission-scoped | `search/page.tsx` — Companies/Branches/Departments/Users/CRM leads-opportunities/master-data; capped at 100 results; no accounting/sales/stock coverage |
| **Command palette** | **Partial — really just a focus shortcut** | Ctrl/Cmd+K focuses the search input; no overlay, no `cmdk` dependency |
| **Quick Create** | **Missing** | No global create-any-record affordance |
| **Tenant context** | Implemented, rigorously | `setTenantContext()` (Postgres GUC) + `tenantTransaction()`; `verifyRuntimeRole()` blocks superuser/BYPASSRLS/CREATEDB DB roles at boot in production |
| **Company/Branch context** | Implemented | `context-switcher.tsx`, scoped by membership-access tables |
| **User/session management** | Implemented | `profile/page.tsx`, `security/page.tsx` + `session-manager.tsx`, `sessions` table with revocation/idle-expiry |
| **Permissions/RBAC** | Implemented with real depth (spread across app/lib + SQL, not centralized in the `permissions` package) | Time-bound (`starts_at`/`expires_at`) and company/branch/team-scoped role assignments verified in `database/control-plane/migrations/018_enterprise_roles_permissions.sql`; SoD conflict rules in `access-control.ts` |
| **Record-level permissions** | **Partial** — company/branch scope only, no per-record ACL | `recordScope()` in `services/api/src/crm.js:1283-1297` filters by company/branch, never by assignee/owner |
| **Field-level permissions** | **Defined but dead** | `hr_payroll.sensitive.view`, `support.sensitive.view`, `procurement.suppliers.sensitive` exist and are assignable, never checked anywhere — see Section 12 |
| **Feature flags** | **Missing** (despite `packages/config`'s own README claiming otherwise) | Only coarse per-org module enable/disable exists, not granular flags |
| **Exports/imports** | **Partial, fragmented** | Real per-module CSV import/export with formula-injection guarding; no unified cross-module UI |

---

## 7. Route Inventory

`apps/web/src/app/(app)` top-level route groups (22): `accounting, approvals, assets, audit-logs, billing, crm, dashboard, hr-payroll, manufacturing, master-data, notifications, point-of-sale, procurement, profile, projects, quality, sales, search, security, settings, stock, support`. Plus `(auth)` (login/signup/verification) and top-level `onboarding/`, `quote/` outside the authenticated shell.

Representative depth by module (subdirectory count under each module's route folder): CRM 24, Accounting 10, Procurement 9, Sales 5; the 8 "roadmap" modules each expose one generic `[resource]/page.tsx` catch-all plus a dashboard route. Every sampled route is functional and DB-backed — no route inspected across any of the six research passes was found rendering hardcoded/mock data in place of a real query (Section 10 confirms this held under an aggressive dedicated placeholder search too).

Every `(app)` module has a matching `apps/web/src/app/api/<module>` route-handler directory except `dashboard`, `search`, and `security` (server components that call `@vercentlabs/api`/DB directly at render time — not orphans, just a different data-fetch pattern) and `master-data` (served by `api/business-data`). No orphan frontend module (with zero backend) and no orphan backend module (with zero frontend consumer) was found.

---

## 8. API Coverage

- `services/api` is a business-logic library imported in-process by both Server Components (rendering directly) and 279 `apps/web/src/app/api/**/route.ts` handlers — there is no separate deployed backend service and no HTTP boundary between "frontend" and "backend."
- Response envelope is consistent across the large majority of routes: `ok(data,status)` → `{ok:true,...data}`, `fail(...)`/`errorResponse(...)` → `{ok:false,message,...}`, defined once in `apps/web/src/lib/http.ts` and reused; 8-route sample across 4 modules found no deviation except the Razorpay webhook (correctly provider-shaped, no browser consumer).
- Pagination is consistently `limit`/`offset` across 11+ sampled routes spanning HR, Support, POS, Quality, Stock, Assets, Projects, Accounting, Manufacturing, business-data; the one exception (`mobile/v1/crm/offline-sync` using `cursor`+`limit`) is a justified divergence for delta-sync, not an inconsistency.
- Validation is `zod` throughout, parsed in try/catch and mapped through a shared `errorResponse()` that never leaks internals.
- Auditing to the central immutable `audit_events` table is **inconsistent**: roughly 62% of mutating routes sampled never call `audit()` directly — partly explained by module-local event/history tables (`accounting_journal_events`, `procurement_events`) providing a second audit tier, but coverage should be treated as unverified-complete outside Accounting/Procurement/CRM.
- Rate limiting (`enforceRateLimit`, DB-backed) is used in only 8 of 279 route files, all auth/invitation/mobile-refresh related. General business CRUD and, critically, 9 public unauthenticated CRM endpoints (public capture, forms, chat, meetings, quotes) have none.
- No OpenAPI/Swagger documentation exists anywhere in the repo.
- Background jobs/outbox: durable outbox tables genuinely exist (`crm_outbox` with lease columns, `procurement_outbox`) and are written to, but the worker that drains them (`process-crm-jobs.mjs`) was deleted along with the rest of `apps/web/scripts/` — see Critical Bugs. The queues are currently write-only in the running system as shipped.

---

## 9. Data Model Coverage

Two independently-numbered migration sequences: `database/control-plane/migrations/001…020` (identity, orgs, roles, sessions, billing, platform admin — `public` schema) and `database/tenant/migrations/001…051` (52 files, per-module business schema — `tenant.` schema). This is a **single shared database, schema-separated** model (not schema-per-tenant, not DB-per-tenant); isolation within `tenant.*` is via `organization_id` + Postgres RLS, not physical separation.

- **Row-Level Security is comprehensive, not partial** — despite `database/tenant/policies/` being an empty README-only directory, every one of the 45 module-migration files that creates tables also runs `ALTER TABLE … ENABLE/FORCE ROW LEVEL SECURITY` plus a `tenant_organization_isolation` policy, confirmed via a full grep of `ENABLE ROW LEVEL SECURITY` across all tenant migrations. `FORCE` is used (not just `ENABLE`), meaning even the table owner cannot bypass RLS.
- **Audit trail is a real, verified Postgres trigger** — `prevent_audit_event_mutation()` bound `BEFORE UPDATE OR DELETE ON audit_events`, raises an exception on any attempted mutation, defined in `database/control-plane/migrations/002_platform_foundation.sql`. This matches CLAUDE.md's claim exactly.
- **No soft-delete columns exist anywhere** in the 52 tenant migrations (`deleted_at` — zero hits repo-wide) — the schema uniformly uses status-based lifecycle instead. This is a deliberate, consistent convention, not drift.
- `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()` and `created_by`/`updated_by uuid` are present on the large majority of business tables. `company_id`/`branch_id` presence is intentionally uneven — some tables are deliberately organization-level.
- A shared `numbering_series` table backs document numbering (`CUS-`, `SUP-`, `QUO-`, `SO-`, `PO-`, `INV-`, `EMP-`, `AST-` prefixes) used consistently across accounting, procurement, sales, and CRM.
- Module table counts: CRM ~200 (22 migrations), Accounting 80 (8 migrations), Sales 28 (3 migrations), Procurement 39 (4 migrations, base tables use an untyped `data jsonb` column rather than typed fields), Stock 9, Manufacturing 14, Projects 13, Assets 12, POS 13, Quality 11, Support 13, HR & Payroll 19.
- Runtime DB-role hardening: `apps/web/src/lib/db.ts` `verifyRuntimeRole()` queries `pg_roles`/`pg_auth_members` at boot and throws if the app's DB credential is superuser, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, or owns relations — enforced in production, opt-in locally via `ENFORCE_RESTRICTED_DB_ROLE=true` (i.e., unchecked by default in dev).

---

## 10. Mock/Placeholder Inventory

A dedicated, aggressive grep pass (mockData/dummy/demo/sample/placeholder/TODO/FIXME/fake, hardcoded literal data arrays, `setTimeout`-simulated latency, `Math.random()`-fabricated data, commented-out fetch calls, empty handlers, bare `alert()`, empty `catch{}`, `@ts-ignore`) across `apps/web/src`, `apps/mobile/src`, and `services/api/src` found **almost no production-facing placeholder code** — a genuine, notable finding, not a gap in the search. Concrete hits:

| File | Line | Finding | Verdict |
|---|---|---|---|
| `apps/web/src/components/logout-button.tsx` | 29 | `window.alert(...)` on failed sign-out | Legitimate error surface |
| `services/api/src/manufacturing/index.js` | 384-387 | `Math.random()` used only in a human-readable document-number fallback (real PK is `randomUUID()`) | Legitimate but worth a P3 hardening note — collision risk in doc numbering |
| `apps/web/src/lib/crm.ts` | 3156 | `"demo"` as a real CRM visit-type enum value | Legitimate business data, not placeholder |
| `apps/web/src/app/api/auth/{signup,resend-verification,forgot-password}/route.ts`, `apps/web/src/app/api/invitations/{route,[id]/route}.ts` | 5 files | `process.env.APP_URL \|\| "http://localhost:3001"` fallback used when building emailed links | **Real production risk (P1)** — if `APP_URL` is unset in production, real users receive password-reset/invite emails containing localhost links. No startup validation catches a missing `APP_URL`. |
| `apps/web/src/components/sales-document-editor.tsx` | 122-153, 278 | Raw `fetch()`+`AbortController` reimplemented inline instead of the shared `requestJson()` | Not fake data — a duplication finding, see Section 15 |

No hits at all for `mockData`, `dummyData`, `TODO`, `FIXME`, "coming soon," no-op click handlers, or hardcoded arrays standing in for API data anywhere in `apps/web/src/app/(app)/**` or `apps/web/src/components/**`. The mock/placeholder risk in this codebase is effectively zero; the real risk is in Section 20 (verification tooling) instead.

---

## 11. Navigation Findings

Navigation is a single typed config, not scattered JSX — `apps/web/src/components/app-shell.tsx` declares `workspaceNavigation`, `moduleNavigation: NavigationGroup[]` (one entry per module, lines 36-768), `workNavigation`, `governanceNavigation`, `settingsNavigation`, typed via `NavigationItem`/`NavigationGroup` and rendered through `NavigationLink`/`NavigationSection`. Permission-gating is wired in (`item.permission` → `hasPermission()`), no feature-flag gating exists. This single definition feeds desktop sidebar, mobile disclosure menu, and the module context bar consistently — genuinely one source of truth for nav itself.

**Migration risk for the CLAUDE.md-described target `NavigationItem`/`ModuleNavigation` typed registry**: the current shape (`app-shell.tsx`'s literal arrays) is already close in spirit — it just isn't extracted into a standalone, importable registry module or typed against a `ModuleId`/`CapabilityId`/`PermissionKey` union from `shared-types`. Migrating should be additive (extract the existing arrays into a new file, add types, re-import) rather than a rewrite. The one real inconsistency to fix first: `apps/web/src/components/breadcrumbs.tsx` maintains an **independent, hardcoded label map** that duplicates labels already declared in the nav config — these two sources can and will drift (e.g., a renamed nav item won't automatically rename its breadcrumb).

---

## 12. Authentication/Permission Findings

**Working correctly, verified end-to-end:**
- Session lifecycle (opaque hashed tokens, httpOnly/secure cookies, absolute + idle expiry) — `apps/web/src/lib/auth.ts`.
- Time-bound role assignments (`starts_at`/`expires_at` with a `CHECK` constraint) and company/branch/team-scoped assignments — real, not aspirational (`database/control-plane/migrations/018_enterprise_roles_permissions.sql`), confirming a specific CLAUDE.md claim.
- Maker-checker/SoD: `packages/workflows` (`assertSeparationOfDuties`, `assertApprovalDecision`, optimistic-concurrency `expectedVersion`) is real and load-bearing for Approvals; Procurement, Quality, and HR & Payroll each additionally hard-code their own self-approval blocks server-side (not just UI-hidden) with exact evidence: `services/api/src/procurement/index.js:1464-1466`, `services/api/src/quality/index.js:364-366`, `services/api/src/hr-payroll/index.js:219,483`.
- Server-side re-enforcement of permissions was spot-checked across Accounting, Procurement, Stock, and Manufacturing (the highest-risk candidates for "UI-only gating") and confirmed correct in every case — mutating service functions independently call `requirePermission`/`permission()`/`need()`/`assertPermission()` even though the page-level route helpers themselves don't gate.
- Role creation additionally enforces a grant-ceiling check (a non-owner cannot grant a permission they don't hold) plus blocking-vs-warning SoD analysis before persisting a role.
- Audit trail immutability is a real database trigger (Section 9).
- RLS on every tenant table is comprehensively enforced with `FORCE`, verified by grep across all 45 module migrations.

**Confirmed security gaps (not yet fixed — flagged per instructions, no changes made):**

1. **Dead field-level permission checks.** `hr_payroll.sensitive.view`, `support.sensitive.view`, and `procurement.suppliers.sensitive` are defined in `packages/permissions/src/{hr-payroll,support}.js`, referenced in role-conflict logic in `apps/web/src/lib/access-control.ts:510,615,715-720`, and assignable to roles — but are never checked in any `.js`/`.tsx` file outside their own definitions. A role granted view access to HR/Support/Supplier records sees every field regardless of whether it also holds the "sensitive" permission; the intended masking control is inert.
2. **No per-record ownership scoping in CRM.** `recordScope()` (`services/api/src/crm.js:1283-1297`) filters only by `company_id`/`branch_id`, never by assignee. Role descriptions (e.g. "Sales Representative — manage assigned leads," `access-control.ts:254-278`) promise narrower scoping than the code enforces; any holder of `crm.leads.manage` can read/write every lead/account/opportunity in their company, not just their own.
3. **No rate limiting on the public CRM lead-capture endpoint.** `apps/web/src/app/api/crm/public/capture/[key]/route.ts` (the endpoint CLAUDE.md names as the real lead-capture mechanism for the landing site) has HMAC proxy-signature verification and body-size limits but never calls `enforceRateLimit()`, unlike 8 other auth-adjacent routes. An attacker can flood any organization's public form key with unlimited POSTs, inflating billing usage counters and/or spamming fabricated leads.
4. More broadly, of 279 route files only 8 use rate limiting at all — general business CRUD (not just the one endpoint above) has none.

No instance of "UI hides it, but the server doesn't check" was found for any of the primary CRUD mutation paths sampled — the codebase's authorization discipline is genuinely strong; the gaps above are specific and narrow, not systemic.

---

## 13. UI/UX Consistency Findings

- Base design language (color, radius, shadow, spacing tokens) is centralized in `globals.css:5-62` and respected by most modules' metric-card/topbar/sidebar visual language.
- **CRM is the one significant outlier.** `crm-product.css` defines its own token set that *overrides* rather than reuses the base scale (`--crm-radius-control:8px` vs. global `--radius-control:10px`; `--crm-control-height:40px` vs. global `--control-height:44px`), and `enterprise-modules.css` layers a second, module-scoped accent-color system (`--module-crm`, `--module-sales`, etc.) on top. CRM additionally has its own bespoke shell (`crm-workspace-shell.tsx`, `crm-action-workbench.tsx`), its own resource manager (`crm-resource-manager.tsx`), and its own kanban board (`crm-pipeline-board.tsx`) — none of which any other module has. This makes CRM visually and structurally the most divergent module, consistent with it being the only module with two dedicated stylesheets.
- All extension/product stylesheets load globally on every route (`layout.tsx:3-9`), so there's no risk of missing styles, but also no scoping — CRM's overridden tokens are cascade-wide.
- No modal/dialog/drawer pattern exists anywhere in the codebase (`role="dialog"`, `<dialog`, `.modal`, `.drawer` all return zero matches) — every "edit" flow is a full page or inline panel. This is a consistent (if minimal) pattern, not an inconsistency, but worth noting for future phases that may want overlay patterns.
- Two independently-maintained, near-identical pagination components exist with the same algorithm copy-pasted (`pagination-controls.tsx` vs `pagination-links.tsx`) rather than one component with two render modes.
- Only one `loading.tsx` exists across 116 `page.tsx` routes, and only one root `error.tsx` (no nested per-route error boundaries) — acceptable today given the low volume of client-side failure modes observed, but a scaling risk as more interactive (client-heavy) pages are added.
- `packages/shared-ui`'s three components (`StatusBadge`, `EmptyState`, `FieldError`) are confirmed **unused** anywhere in `apps/web/src` (zero imports) despite being a declared dependency — dead weight, not merely minimal.

---

## 14. Critical Bugs

All evidence-backed, no speculation:

1. **Broken production worker container.** `infrastructure/docker/Dockerfile.worker:35` runs `node scripts/process-crm-jobs.mjs` and copies `apps/web/scripts` into the image, but that directory is empty on disk (deleted in commit `90ee1c8`). The worker container will fail at startup with `MODULE_NOT_FOUND`, not merely when a developer manually runs the npm script. Given the `crm_outbox`/`procurement_outbox` tables are actively written to but nothing drains them, this is a live functional gap, not a hypothetical one.
2. **Localhost URL fallback in production emails.** Five route files (Section 10) fall back to `http://localhost:3001` when `APP_URL` is unset, with no startup-time validation — password-reset, verification, and invitation emails could be sent with dead links in a misconfigured production deploy.
3. **Node engine mismatch.** `package.json` declares `"node": ">=24 <25"`; the environment used for this audit runs `v26.5.0`. Every `pnpm` command prints `[WARN] Unsupported engine`. Not yet observed to cause a functional failure, but the declared constraint and the actual runtime disagree.
4. **`apps/mobile`'s own `test` script is guaranteed to fail.** `apps/mobile/package.json`'s `"test": "node --test tests/*.test.mjs"` targets a `tests/` directory that no longer exists (same deletion commit) — running it will error rather than silently no-op, unlike `apps/web`'s equivalent.
5. **A stale claim in `CLAUDE.md`** ("apps/landing DOES NOT CURRENTLY EXIST... deleted, uncommitted") is factually wrong as of this audit — `apps/landing` exists, is git-tracked, and has 5+ recent commits. Not a bug in the product, but a bug in project-instruction accuracy that could mislead a future session into re-scaffolding something that already exists. Recommend correcting `CLAUDE.md` separately (out of scope for this prompt, which forbids implementation).

---

## 15. Technical Debt

**P0 — blocks product/security/data integrity**
- The entire verification/test safety net (`apps/web/tests/`, `apps/web/scripts/`, `apps/mobile/tests/`) was deleted in commit `90ee1c8` (2026-08-05, 96 files / 13,334 lines) without any `package.json` cleanup. ~80 of ~140 root scripts are now dangling references. `apps/web` and `apps/mobile` have zero executable automated tests. No CI covers `apps/web`, `apps/mobile`, or `services/api` to catch this class of regression (`.github/workflows/` only has landing-site workflows).
- The background-job worker container is broken (Critical Bug 1) — outbox queues are write-only in the running system.

**P1 — major functional issue**
- Dead field-level "sensitive" permission checks (Section 12, gap 1).
- No per-record ownership scoping in CRM despite role-description promises (Section 12, gap 2).
- No rate limiting on the public CRM lead-capture endpoint (Section 12, gap 3).
- `http://localhost:3001` fallback in 5 production email-generating routes with no startup validation.
- `services/api/src` has **zero** unit tests for ~26,000+ lines of business logic across Accounting, Sales, CRM (the double-entry balance check, close-task sequencing, and reconciliation-matching logic are entirely unverified by any automated test).
- README.md's product-scope narrative (four modules released, eight roadmap) contradicts the shipped code and should be corrected before it misleads planning for Prompts 2-102.

**P2 — architecture/maintainability**
- Three parallel, near-duplicate generic CRUD table/resource managers (`resource-manager.tsx`, `crm-resource-manager.tsx`, `business-data-manager.tsx`) instead of one canonical, parameterized implementation.
- Two near-identical pagination components (`pagination-controls.tsx`, `pagination-links.tsx`) with the same algorithm duplicated.
- `sales-document-editor.tsx` reimplements raw `fetch()`+`AbortController` instead of reusing the shared `requestJson()` wrapper used everywhere else.
- Three overlapping permission-check helpers (`requirePermission`, `requireApiPermission`, `requirePermissionFromSession`) with inconsistent guard strength — `requireApiPermission` additionally checks `emailVerified`/`organizationId`, the other two don't, and it's unclear whether that's intentional per-route or accidental drift.
- `breadcrumbs.tsx`'s independent hardcoded label map duplicates the nav config (Section 11).
- `packages/shared-ui` is a dependency with zero real consumers — either wire it up or remove it as a dependency.
- `packages/config`'s own README claims feature-flag support that doesn't exist in the code.
- `Math.random()`-based document-number fallback in `services/api/src/manufacturing/index.js:387` (real PK is a UUID, but the human-readable number has a theoretical collision risk).
- Auditing coverage to the central `audit_events` table is inconsistent (~62% of mutating routes sampled don't call it directly) and hasn't been verified complete via the module-local event-table fallback pattern outside Accounting/Procurement/CRM.

**P3 — cosmetic/non-critical**
- 7 dead documentation links in root `README.md` (`PROJECT_STRUCTURE.md`, `docs/architecture/enterprise-module-completion.md`, and 5 others — none exist on disk).
- `.status-badge`/`.status-pill` — two class names used inconsistently for what appears to be the same badge concept.
- CRM's token-scale override (`crm-product.css`) versus the base design-token scale — cosmetically real but not incorrect, worth reconciling if/when a shared component library is introduced.

---

## 16. Preserve List

These should **not** be unnecessarily replaced by future prompts — they are genuinely strong:

- **The RBAC/session/audit stack** — `apps/web/src/lib/{auth,authorization,access-control,security}.ts`, the time-bound/scoped `user_role_assignments` schema, the `packages/workflows` SoD/approval engine, and the database-trigger-immutable `audit_events` table. This is production-grade and should be extended, not rebuilt.
- **RLS enforcement pattern** — the `ENABLE`+`FORCE ROW LEVEL SECURITY` + `tenant_organization_isolation` policy convention applied consistently across all 45 module migrations. Any new module migration should follow this exact pattern.
- **`verifyRuntimeRole()`** (`apps/web/src/lib/db.ts`) — a genuinely rigorous defense-in-depth guarantee against RLS bypass via a misconfigured DB credential; worth extending to run in dev too (currently opt-in locally).
- **Financial-decimal engine** (`services/api/src/financial-decimal.js`) — BigInt fixed-point math avoiding float-precision bugs, shared by Accounting and Sales; any new money-handling module should reuse it, not reinvent.
- **The `AppShell`/nav-config pattern** — one canonical component and config feeding desktop, mobile, and module-context-bar consistently. The eventual typed `NavigationItem` registry described in CLAUDE.md/Step 7 can be extracted from this without a rewrite.
- **`http.ts`'s response-envelope convention** (`ok()`/`fail()`/`errorResponse()`) and the `requestJson()` client wrapper — consistently adopted, should remain the standard for all new routes/components.
- **CSV import/export plumbing** (`apps/web/src/lib/csv.ts`, `packages/reporting-engine`'s `csvCell`/`rowsToCsv`) — includes real formula-injection neutralization; reuse rather than reimplement when building a unified Data Management surface.
- **Accounting's governance-dashboard pattern** (`payables-governance.js`, `receivables-governance.js`, `banking-governance.js`, `tax-reporting-governance.js`) — a good template for giving the 8 "roadmap" modules deeper, per-subsystem dashboards later.
- **Razorpay billing integration**, including the webhook-recovery and state-machine migrations — mature, don't rebuild.

---

## 17. Missing Capability Summary

**Already complete** (per module, evidence in Section 5): core CRUD + governance/state-machine logic for all 12 business modules; RBAC, sessions, audit trail, billing, approvals, tenant isolation (Section 6/12).

**Partially complete**: Assets (inspections/transfers are read-only), Support (escalation model exists, auto-trigger not wired), HR & Payroll (no GL-posting integration to Accounting), Procurement (generic JSONB-backed CRUD rather than typed per-resource logic), record-level/field-level permissions (company/branch scope only, "sensitive" field flags inert), Data Management/Exports (real per-module, no unified surface), Notifications (basic inbox, no preferences), Command palette (focus-shortcut only).

**Missing**: Tasks (dedicated feature), Follow-ups & Reminders (platform-level), Exceptions (unified inbox), Recent Records, Favourites, Compliance (unified), Automation (rule engine), Reports & Analytics (unified surface), Integrations (framework), Quick Create, feature flags (granular), modal/dialog UI pattern, dark theme, chart library, command palette (real one).

**Unclear / needs runtime verification** (static analysis alone can't fully confirm): actual behavior of `verify:*` scripts if reconstructed (they're gone, so pass/fail is currently undetermined rather than "failing"); whether the outbox-drain worker was ever deployed/running before the deletion; whether MFA enrollment data currently exists for any real user (schema-ready per Security page's own disclosure, enforcement unconfirmed); full audit-event coverage outside Accounting/Procurement/CRM.

---

## 18. Recommended Execution Order

Based on actual dependency relationships discovered (not speculative):

1. **Correct the product-scope narrative** (README.md, and any planning docs downstream of it) to reflect that all 12 modules are code-real, before any prompt makes a scoping decision based on the stale "four modules" claim.
2. **Decide the fate of the deleted verification suite** — either restore it from before `90ee1c8` and re-validate against current code, or make a deliberate, documented decision to rebuild it smaller/differently. This blocks safely validating *any* future prompt's changes against regressions, so it should happen before Prompts 2+ touch business logic.
3. **Close the three confirmed security gaps** (dead field-level permissions, CRM record-ownership scoping, public-endpoint rate limiting) — narrow, well-understood fixes, low risk of destabilizing other work, high value to fix before broader UI/feature work increases the CRM/HR/Support surface area.
4. **Fix the broken worker deployment** (`Dockerfile.worker` target) — needed before outbox-dependent features (CRM job processing, billing webhook retry) can be relied on.
5. **Consolidate the 3 duplicate resource managers and 2 duplicate pagination components** — do this before Phase 2-8 UI work multiplies the number of places that would otherwise need the same fix applied 3+ times.
6. Proceed with the 8 "roadmap" modules' deeper build-out (per-subsystem service files, dashboards, tests) using Accounting's governance-dashboard pattern and CRM's per-subsystem service-file pattern as the template — they are already substantially implemented, so this is depth work, not greenfield work.
7. Backfill `services/api` unit tests for Accounting/Sales/CRM's financial and state-machine logic — currently the highest-value, zero-coverage code in the repo.

---

## 19. Files Likely to Be Touched in Prompts 2-10

Identified, not modified:

- `README.md` (scope narrative correction)
- `apps/web/scripts/`, `apps/web/tests/`, root `scripts/`, root `tests/` (verification-suite restoration/rebuild)
- `infrastructure/docker/Dockerfile.worker`
- `packages/permissions/src/{hr-payroll,support}.js`, `services/api/src/{hr-payroll,support,procurement}/index.js` (wiring the dead sensitive-field checks)
- `services/api/src/crm.js` (`recordScope`, adding assignee-based scoping)
- `apps/web/src/app/api/crm/public/capture/[key]/route.ts` (rate limiting)
- `apps/web/src/app/api/auth/{signup,resend-verification,forgot-password}/route.ts`, `apps/web/src/app/api/invitations/{route,[id]/route}.ts` (`APP_URL` fallback/validation)
- `apps/web/src/components/{resource-manager,crm-resource-manager,business-data-manager}.tsx` and `{pagination-controls,pagination-links}.tsx` (consolidation)
- `apps/web/src/components/sales-document-editor.tsx` (fetch-wrapper consolidation)
- `apps/web/src/lib/authorization.ts` (permission-helper consolidation)
- `apps/web/src/components/breadcrumbs.tsx` (label-map deduplication against nav config)
- `packages/shared-ui` (wire up or remove)
- Per-module `services/api/src/<module>/index.js` files for Stock/Manufacturing/Projects/Assets/POS/Quality/Support/HR&Payroll (deepening into per-subsystem files as they mature)

---

## 20. Verification Results

Commands run (all read-only/non-destructive; no migrations executed, no databases modified):

| Command | Result |
|---|---|
| `git status --porcelain -uall` | Clean — no output, confirming the working tree had no pending changes before this audit began |
| `pnpm --filter @vercentlabs/web test` | `[WARN] Unsupported engine: wanted {"node":">=24 <25"} (current: v26.5.0)`. `node --test` → `tests 0, suites 0, pass 0, fail 0, cancelled 0, skipped 0, todo 0`. Confirms `apps/web/tests/` is empty/absent. |
| `pnpm --filter @vercentlabs/api test` | Same engine warning. `node --test` → `tests 0, pass 0, fail 0`. Confirms no test files exist in `services/api`. |
| `find`/`ls` checks on `scripts/`, `tests/`, `apps/web/scripts/`, `apps/web/tests/`, `apps/mobile/tests/`, `docs/architecture/`, `PROJECT_STRUCTURE.md`, and the 6 other README-referenced docs | All confirmed absent from disk (see Sections 3, 14, 15, 20's Part-1 research pass for the full dangling-reference list) |
| `git log` on the deletion | Commit `90ee1c8` ("chore: remove legacy app checks and restore dependency patch", 2026-08-05) — 96 files deleted, 13,334 lines removed, 26 lines added (a pnpm patch + lockfile edit only); zero `package.json` files touched |
| `pnpm --filter @vercentlabs/web typecheck` | `[WARN] Unsupported engine` (same as above). `tsc --noEmit` completed with **zero errors and zero output** — the entire `apps/web` TypeScript codebase type-checks cleanly. |
| `pnpm --filter @vercentlabs/web lint` | `[WARN] Unsupported engine` (same as above). `eslint .` → **1 warning, 0 errors**: `apps/web/src/app/api/crm/marketing/attribution/route.ts:30:26` — `'_request' is defined but never used` (`@typescript-eslint/no-unused-vars`). Effectively a clean lint pass. |

No destructive commands (`db:migrate*`, `db:backup`, `db:restore`, any `--force`/`--hard` git operation) were run. No new dependencies were installed. No files outside this audit report were created or modified.

**Net verification-quality signal**: static analysis (typecheck, lint) on `apps/web` is essentially clean — the codebase is well-formed TypeScript with negligible lint debt. The P0 finding in Section 15 is not "the code is broken," it's "the code has no automated behavioral tests" — a materially different and more specific risk than a failing build would be.
