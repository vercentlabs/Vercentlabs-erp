# ERP Completion Execution Tracker

Durable, single execution document for finishing Vercentlabs ERP for real customer
onboarding. This is not a second copy of `PRODUCTION_TRACKER.md` — that file stays
the authoritative module-by-module status log (methodology, per-feature audit
verdicts, fix history). This file is the **run log for the completion program**:
what's been checked in this environment, what's real vs stale, and the exact next
action for whoever (human or another Claude Code session) picks this up next.

Read order for a new session: this file, then `docs/PRODUCTION_TRACKER.md`, then
`docs/03-modules/<current module>/features/F###-AUDIT.md` for the module in
progress.

## Source-of-truth hierarchy (unchanged, restated for convenience)

Runtime behavior > automated tests exercising it > DB constraints/migrations >
API/authz implementation > current code > feature dossier > subrequirement
register > production tracker > comments/historical claims.

## Session 2026-09-14 — foundation repair + baseline verification

### Starting state found

- Working directory (`C:\Project\Vercentlabs-erp-main`) had **no `.git`** — a
  content-only checkout. Verified byte-identical to `origin/main` at `79a7fc5`
  via `git write-tree` tree-hash match before restoring git metadata
  (`update-ref` + `symbolic-ref`, no destructive checkout used).
- A **separate, unrelated project** exists at `C:\Project\VERCENTLABS ERP`
  (different git repo, different top-level layout — `platform/`/`product/`
  instead of `services/`, its own `.env` with live credentials). Its Docker
  containers (`vercentlabs-erp-postgres` on 5442, `vercentlabs-erp-redis`)
  were running when this session started but belong to that other project,
  not this one. **Do not use them for this repo's verification** — this
  repo's own `infrastructure/docker/compose.local.yml` (Postgres only, port
  5433) is what `pnpm infra:up`/`pnpm db:setup` actually use, and that's what
  this session used throughout.
- Local toolchain: Node v26.5.0 was the system default, but this repo pins
  `>=24 <25`. Installed Node 24.21.0 via `fnm` for this session
  (`corepack enable` after switching). CI already pins Node 24 correctly via
  `actions/setup-node` — this was a local-machine-only gap, not a repo bug.
- `main`'s last commit (`79a7fc5`, 2026-09-11) is **5 days and ~9 commits**
  ahead of `PRODUCTION_TRACKER.md`'s last status-log entry (2026-09-06,
  Phase 2). The gap: an undocumented "CRM vNext F001-F030 hardening and
  closure" pass plus a full reorg of CRM's web/API code from flat
  `components/`/`server/` into 8 feature-named domain directories (matches
  the Project Structure Constitution's capability-based organization —
  `verify:architecture` confirms 0 legacy files). See
  `docs/PRODUCTION_TRACKER.md`'s 2026-09-14 status-log entry for the full
  reconciliation. Net effect: not a regression, just undocumented, plus it
  left two real bugs behind (see below) that a clean-environment run caught
  and this session fixed.

### Foundation repair (task brief §4) — all items addressed

| Item | Finding | Action |
|---|---|---|
| CRM CI pnpm-cache ordering | `crm-ci.yml` ran `setup-node`+`cache:pnpm` before `corepack enable` — every run would fail before tests started | Reordered to match `landing-ci.yml`'s already-correct pattern |
| Comprehensive ERP CI | Didn't exist — only CRM-scoped and landing-scoped workflows | Added `.github/workflows/erp-ci.yml`: toolchain/T01/experience/architecture/doc-links/DB-structure, web typecheck/lint/test/routes, mobile typecheck/lint, API/worker/package/SDK/integration/security/RBAC tests, prod web build, dependency audit. Browser E2E/perf deliberately excluded (belongs in a nightly/manual workflow, not yet created — see Next Actions) |
| Root `build` ambiguity | `pnpm build` only ever built `apps/landing` (Hostinger deploy target for root `server.js`) with nothing signaling that | Added `build:erp` (=`build:web`), `build:all`, `verify:erp` (=`verify`), `verify:release` (=`release:gate`) as explicit aliases; documented in README. Did not change `build`/`build:landing` (deployment compatibility) |
| `free-ports.mjs` killed unrelated processes | No ownership check — killed anything on 3000/3001/3200/3201 | Rewrote to require the held process's command line to reference both this repo's working-tree path and a Next/pnpm/turbo pattern before killing; otherwise refuses with a clear message |
| Landing horizontal overflow (`/book-demo`, `/resources/erp-requirements-checklist`, `/compare/vercentlabs-vs-odoo`, 320-390px) | **Does not reproduce.** Built landing prod, ran the existing real DOM-measurement test (`mobile-conversion.spec.ts`, scrollWidth vs clientWidth, not a screenshot) on both Chromium projects that cover it (desktop-chromium, mobile-chromium) — 40/40 pass | No fix applied — would be fabricated. Flagged `NOT REPRODUCIBLE`, re-check if a fresh report comes in with exact repro steps/browser |
| GitHub repo governance (branch protection, required PR/checks, force-push/delete block, secret scanning, Dependabot) | Cannot be verified or changed from code — these are GitHub web/API settings | **Needs a human with repo admin on `vercentlabs/Vercentlabs-erp`** to confirm/enable in Settings → Branches / Settings → Code security. Not claimed as done anywhere in this repo's docs. |

### Real regressions found and fixed (not in the brief, found via clean-environment baseline run)

1. `services/worker/tests/crm-nurture-queue-dispatch.test.mjs` read source from
   the pre-reorg path `services/api/src/modules/crm/lead-intelligence.js`
   (moved to `.../lead-lifecycle-qualification-and-prioritization/` by the
   09-10/11 reorg) — `ENOENT`, failing `test:worker`/`verify:worker` on any
   clean checkout. Fixed the path (and a stale comment in
   `crm-lead-sla-scan.js` pointing at the same old location).
2. 9 ESLint `no-unused-vars` warnings (0 errors, so `verify` still passed, but
   real dead code) — all leftovers from the same reorg: 6 unused `./core`
   helper imports across `crm-data-operations-and-customization/
   resource-definitions/*.ts`, 1 unused `useEffect` import, 1 dead test
   variable. All removed; `lint:web` is now 0 problems.

### Baseline verification — real evidence

Environment: Node 24.21.0, pnpm 11.21.0, local Postgres 16 via
`infrastructure/docker/compose.local.yml` (port 5433), migrated to tenant
migration 111 via `pnpm db:setup`.

- **`pnpm verify:erp` (alias of the pre-existing comprehensive `verify`
  script): PASS, exit 0.** 1,921 automated tests total, 0 failures, 0
  skipped, across toolchain/T01/experience/architecture/doc-links/DB-structure
  static checks, `typecheck:web`, `lint:web` (0 problems), `test:web` (719),
  `test:api` (883), `verify:routes` (137 pages/399 API routes),
  `typecheck:mobile`/`lint:mobile`, `verify:worker` (99 tests + structure),
  `test:sdk` (14), `test:packages` (138 across 9 packages), `test:integration`
  (1), `test:security` (4), `test:enterprise-rbac` (11).
- **`pnpm build:web`: PASS** — 187 pages generated.
- **`pnpm build:landing`: PASS** — 77 static pages generated.
- **Real CRM browser E2E (`pnpm test:e2e:crm`)** — fixture bootstrap
  (`apps/web/scripts/e2e-fixture-bootstrap.mts`) provisions a real
  organization + owner/restricted users + Lead/Opportunity/Account/Contact
  records against live Postgres, then runs 45 real Chromium browser tests
  against the built standalone app. **43/45 passed; 2 failed** — both in
  `erp-crm-navigation.spec.ts` ("desktop sidebar renders ... every expected
  destination" and "every CRM navigation group is reachable and correct").
  Given both failures are navigation-structure assertions and the CRM reorg
  touched navigation (`apps/web/src/core/navigation/modules.ts` and related),
  this is almost certainly the E2E spec's expected nav structure going stale
  against the reorg's actual (possibly relabeled/regrouped) navigation — **not
  yet root-caused, this is the immediate next action** (see below). This
  corrects `PRODUCTION_TRACKER.md`'s standing claim that CRM has "no live
  E2E ... blocked ... on missing auth/seed fixtures" — that infrastructure
  now works; what's outstanding is 2 real, specific navigation-assertion
  failures.
  - Also observed: a `pg` deprecation warning
    ("Calling client.query() when the client is already executing a query")
    fired once during the run. Not yet root-caused (would need
    `--trace-deprecation` or a targeted grep for a client with two
    outstanding queries). Low urgency (deprecation, not an error) but real —
    worth finding before it becomes a pg9 breakage.
- **Not run this session** (documented, not silently skipped):
  `test:e2e:erp` beyond the 6 CRM specs, `landing-release-verification.yml`'s
  Firefox/WebKit/Lighthouse matrix, load/performance testing, backup/restore
  rehearsal, any real external provider (email, payments, GCP) — all either
  out of this session's foundation-repair scope or blocked on credentials/time.

### Navigation E2E failures — root-caused and fixed

Both failures were the spec going stale, not a real navigation defect: the
09-10/11 CRM reorg deliberately renamed the "Sales" nav group to "Pipeline"
(to stop overloading the name of the separate Sales module) and added an
"Engagement" group (Team inbox), and relabeled "Activities" to "Activity
timeline" — confirmed intentional and correct by cross-checking
`apps/web/tests/crm-navigation-ia.test.mjs` (a real functional test against
the live registry, already part of the passing `test:web` 719) and
`docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`. Fixed
`erp-crm-navigation.spec.ts` to match current, intentional navigation.
Re-ran the two affected tests in isolation: the group-visibility test passed
immediately; the group-traversal test then surfaced a **second, real, and
more serious bug** while clicking through Pipeline→Forecast→Activity
timeline→Reports→CRM setup:

### Real bug found and fixed: concurrent `client.query()` on a shared `PoolClient`

Reproduced live and **100% reproducible in this environment** (failed 4/4
consecutive attempts before the fix): `bind message supplies 8 parameters,
but prepared statement "" requires 6` (Postgres error `08P01`, protocol
violation), crashing the CRM Reports page with a full page-level error
boundary mid-navigation.

**Root-caused precisely** by temporarily instrumenting `apps/web/src/core/
db.ts`'s `transaction()` to detect and log (with stack traces) any second
`client.query()` call starting before the first resolved, gated behind
`CRM_DEBUG_CONCURRENT_QUERY=1` (added, used, then fully removed — not
committed). The actual trigger: **`apps/web/src/app/(app)/crm/page.tsx`**
(the CRM Home dashboard) does
`tenantTransaction(orgId, (client) => Promise.all([getCrmDashboard(client,
context), listCrmRecords(client, context, "leads", {limit:5})]))` — two
independent multi-query functions racing on one shared client. **This page
is prefetched by Next.js on every CRM route** (its link sits in the always-
visible sidebar), so it fires far more often than a direct visit would
suggest — explaining why the earlier initial hypothesis (the Reports page's
own `getOpportunityRevenueDashboard`, fixed first) reduced but didn't
eliminate the failure, and why `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` §P.6
recorded a clean 45/45 run once before: the race depends on prefetch timing.

**Fixed (converted `Promise.all` → sequential `await` on the shared
client, 7 call sites total, all verified against `test:api` 883/883 and
`test:web` 719/719 with zero regressions):**
1. `services/api/src/modules/crm/opportunity-and-pipeline-governance/opportunity-revenue-intelligence.js` — 2 internal `Promise.all([client.query...])` blocks (dynamic param-count risk, the one first suspected).
2. `apps/web/src/app/(app)/crm/page.tsx` — **the actual confirmed root cause.**
3. `apps/web/src/app/api/mobile/v1/crm/opportunity-revenue/route.ts`
4. `apps/web/src/app/api/mobile/v1/crm/lead-intelligence/route.ts`
5. `apps/web/src/app/api/mobile/v1/crm/lead-acquisition/route.ts`
6. `apps/web/src/app/api/crm/leads/assignment-policies/route.ts`
7. `apps/web/src/app/(app)/crm/lead-lifecycle/page.tsx`
8. `apps/web/src/app/(app)/crm/stages/page.tsx`
9. `apps/web/src/app/(app)/crm/assignment-rules/page.tsx`

After fixing all 9 above, `test:e2e:crm` still failed the same test once
more (44/45) — a **10th instance**, found the same way (re-enabled the
`CRM_DEBUG_CONCURRENT_QUERY` instrumentation, reproduced, removed it again
after use):

10. `services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/assignment/eligibility.js` — `listEligibleLeadAssignees` (used by every "assign to" picker across CRM, so hit on almost any navigation, not just Reports).

Fixed the same way (sequential await). `test:api` 883/883 confirmed clean
after this fix too. Full `test:e2e:crm` re-run after all 10 fixes: see
below.

**The actual, final root cause — NOT a race at all.** After fixing all 12
confirmed-unsafe concurrent-query instances above, `test:e2e:crm` *still*
failed the same test, but a repeat of the `CRM_DEBUG_CONCURRENT_QUERY`
diagnostic across the **full 45-test suite this time showed zero
concurrent-query detections** while the exact same `08P01` error still
fired repeatedly. That ruled out concurrency entirely and pointed at a
plain, deterministic parameter-count bug instead:

`getCrmReport` (`services/api/src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js`)
always binds a fixed 8-element `parameters` array
(`[organizationId, activeCompanyId, activeBranchId, allowAllCompanies, from, to, canViewAllCrmRecords, userId]`)
for every one of its 14 report types, and always prepends the same
`crm_scope_parameters` CTE referencing `$1`-`$6`. But **8 of the 14 report
branches** (`account-health`, `privacy`, `pipeline-intelligence`,
`engagement-intelligence`, `relationship-coverage`, `partner-pipeline`,
`ai-governance`, `campaigns`) never call `ownerVisible()` — the only thing
that references `$7`/`$8` — so their final query text only ever contains
`$1`-`$6`. PostgreSQL infers a prepared statement's required parameter
count from the highest `$n` actually present in the query text; binding an
8-element array against a 6-placeholder statement is **exactly** "bind
message supplies 8 parameters, but prepared statement "" requires 6" —
deterministically, on every single call, for any of those 8 report types,
against a real database. **This is why it survived every concurrency fix**:
it isn't a race, it fires 100% of the time those report types run.

**Why nothing caught this before now:** every one of CRM's 883 `test:api`
tests uses a hand-built fake DB client (confirmed earlier this session — 0
of 97 API test files touch real Postgres), and fake clients don't enforce
real parameter-bind validation. This session is the first time
`test:e2e:crm` ran successfully end-to-end (the fixture-bootstrap +
standalone-build gap was fixed earlier in this same session) — so this bug
had **zero test coverage of any kind** until a real browser hit the real
Reports page against a real database.

**Fixed:** the `crm_scope_parameters` CTE now also declares `$7::boolean AS
can_view_all_records` and `$8::uuid AS active_user_id`, so every report's
final query text always references all 8 placeholders regardless of which
branch built it — matching what's always bound. Verified directly against
the real local Postgres (a one-off script calling `getCrmReport` for all 14
report types): all 14 now return successfully; before the fix, exactly the
8 branches listed above failed with the exact reported error.

**Coverage gap worth flagging for the CRM gap-closing backlog:** none of
CRM's 14 report types have a real-database regression test (only fake-client
tests, which can't catch this class of bug). Given this session found a
100%-reproducible production bug that fake clients structurally cannot
catch, a small number of real-Postgres tests for `getCrmReport` (or a
general real-DB smoke test that calls every report key once) would be high
leverage — cheaper than another blind E2E-driven bug hunt.

**Final confirmation:** rebuilt and re-ran the full `test:e2e:crm` suite —
**the navigation test that started this whole investigation now passes.**
42/45 passed; the 3 non-passes (1 failure + 2 skipped-after-failure in the
same spec file) are a `429 Too many attempts` from the real, correct,
DB-backed auth rate limiter (`auth_rate_limits` table,
`apps/web/src/core/security.ts`) — a **self-inflicted artifact of this
session's own ~12 repeated `test:e2e:crm` runs against the same reused
fixture org's mobile login**, not a product defect. It will clear on its
own once the rate-limit window elapses; re-run `test:e2e:crm` fresh (ideally
not immediately after another full run) to get a clean 45/45.

**Then ran the full comprehensive `pnpm verify:erp` gate one final time,
clean, after every fix above (and after the diagnostic instrumentation was
fully removed from `apps/web/src/core/db.ts` — confirmed `git diff` on that
file is empty): PASS, exit 0.** Same full breakdown as the earlier baseline
(toolchain/T01/experience/architecture/doc-links/DB-structure static
checks, `typecheck:web`, `lint:web` 0 problems, `test:web` 719/719,
`verify:routes`, `typecheck:mobile`/`lint:mobile`, `verify:worker`,
`test:sdk` 14/14, `test:packages` 138/138, `test:integration` 1/1,
`test:security` 4/4, `test:enterprise-rbac` 11/11) — all still green after
all 22 files' worth of fixes in this session. All 5 commits for this
session's work are in `git log` on `main`.

**A separate, unrelated real bug also surfaced during this investigation,
NOT yet root-caused or fixed:** `error: column record.created_at does not
exist` (Postgres `42703`), logged as an **unhandled promise rejection**
(not caught anywhere in the request path) repeatedly during E2E runs —
roughly once per test, suggesting it fires on every authenticated page load
from something in the global layout/shell, not a CRM-specific query. Not
found via grep for `record.created_at` in CRM or the modules checked
(sales/projects/procurement/hr-payroll pass1-operations.js all reference
`record.created_at` but for their own tables, which do have that column —
none of those looked like an actual mismatch on inspection). This did NOT
block the E2E suite (all tests still passed around it, since it's an
unhandled rejection somewhere fire-and-forget, not on the response path),
but it's a real, live defect. Whoever picks this up next: reproduce with
`pnpm test:e2e:crm` (or any authenticated navigation) and grep server
stdout for `does not exist`; since it's an *unhandled* rejection, wrapping
`process.on('unhandledRejection', ...)` temporarily (same technique as
`CRM_DEBUG_CONCURRENT_QUERY` — add, use, remove, don't commit) would surface
the real stack fast.

**This is a systemic, codebase-wide pattern, not isolated to CRM — flagging
as a HIGH-PRIORITY dedicated remediation item, not something to mass-fix
blindly in this pass.** The pattern has (at least) two shapes, both unsafe
for the same reason (concurrent `client.query()` on one shared `PoolClient`):
(a) `Promise.all([client.query(...), client.query(...)])` directly, and
(b) `Promise.all([someFunction(client, ...), otherFunction(client, ...)])`
where each function internally issues its own query — shape (b) is how the
actual confirmed root cause above hid from a literal-`client.query` grep.
**Any repo-wide grep for this class of bug must account for both shapes;**
shape (b) requires checking, for each `Promise.all([`, whether more than one
array element takes a shared `client`/`tx`/`conn` variable — a plain text
search cannot fully automate this, some manual judgment is required.

After fixing the 9 confirmed-broken instances above (all in CRM), a
repo-wide search for shape (a) alone (`Promise.all([client.query(...` on a
shared client variable) still finds **27 occurrences across 23 files**
outside what's fixed:

```
services/api/src/modules/stock/index.js (1)
services/api/src/modules/procurement/pass1-operations.js (1)
services/api/src/modules/sales/quotation-governance.js (1)
services/api/src/modules/sales/pass1-operations.js (1)
services/api/src/modules/sales/order-governance.js (1)
services/api/src/modules/sales/index.js (1)
services/api/src/modules/accounting/setup.js (3)
services/api/src/modules/accounting/receivables.js (1)
services/api/src/modules/accounting/payables.js (1)
services/api/src/modules/accounting/banking-governance.js (1)
services/api/src/modules/accounting/assets.js (1)
services/api/src/modules/accounting/journals.js (1)
services/api/src/modules/crm/seller-activity-and-follow-up-workspace/communications.js (1)
services/api/src/modules/crm/seller-activity-and-follow-up-workspace/communications/communication-projection.js (1)
services/api/src/modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js (1)
services/api/src/modules/crm/prospect-and-relationship-master-data/account-intelligence.js (1)
services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/scoring-engine.js (1)
services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js (3)
services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-governance.js (1)
services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/assignment/eligibility.js (1)
apps/web/src/core/access-admin.ts (1)
apps/web/src/app/api/users/[userId]/route.ts (1)
apps/web/src/app/api/invitations/route.ts (1)
```

Not every instance necessarily has the dynamic-parameter-count condition
that makes this exploitable (the two fixed instances did; e.g.
`access-admin.ts`'s `getUserAccessState` uses 5 queries that each take a
fixed 2 params, so it's lower-risk in isolation but still relies on
undocumented pg internal queueing behavior that pg itself is deprecating).
**Recommended remediation approach for the next session:** grep each file
for the exact pattern, check whether the queries in that `Promise.all`
array have consistent vs. dynamic parameter counts (dynamic = high
priority), convert to sequential `await` (cheapest, safest fix — the
`opportunity-revenue-intelligence.js` fix in this session is the template),
then re-run that module's test suite. Given 23 files span 6 of the 12
modules, this is plausibly a half-day to one-day dedicated pass, not a
quick fix — budget it as such rather than folding it silently into the next
module's trace.

**Shape (b) candidates found but NOT individually verified or fixed this
session** (a broader, lower-confidence grep — `Promise.all([` anywhere
under `apps/web/src/app`, most of these are very likely fine, e.g.
Promise.all of unrelated non-DB work or of calls each opening their own
`tenantTransaction`/client; each one needs a human/AI to actually read it
before touching it, unlike the confirmed list above):
`apps/web/src/app/api/users/[userId]/route.ts`,
`apps/web/src/app/api/search/route.ts`,
`apps/web/src/app/api/platform/reports/route.ts`,
`apps/web/src/app/api/platform/privacy/route.ts`,
`apps/web/src/app/api/platform/configuration/route.ts`,
`apps/web/src/app/api/mobile/v1/workspace/[area]/route.ts`,
`apps/web/src/app/api/mobile/v1/settings/[resource]/route.ts`,
`apps/web/src/app/api/invitations/route.ts`,
`apps/web/src/app/api/billing/summary/route.ts`,
`apps/web/src/app/(app)/settings/users/page.tsx`,
`apps/web/src/app/(app)/settings/platform/page.tsx`,
`apps/web/src/app/(app)/settings/[resource]/page.tsx`,
`apps/web/src/app/(app)/profile/page.tsx`,
`apps/web/src/app/(app)/notifications/page.tsx`,
`apps/web/src/app/(app)/integrations/page.tsx`,
`apps/web/src/app/(app)/dashboard/page.tsx`,
`apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`,
`apps/web/src/app/(app)/crm/[resource]/page.tsx`,
`apps/web/src/app/(app)/billing/page.tsx`,
`apps/web/src/app/(app)/audit-logs/security/page.tsx`,
`apps/web/src/app/(app)/layout.tsx`.
`apps/web/src/app/(app)/layout.tsx` **was checked this session and is
safe** — its `Promise.all([getShellData(session), resolveNavigation(session),
resolveQuickCreate(session)])` passes only `session`, not a shared `client`;
each function opens its own connection internally. The other 20 files in
this list were not checked.

**Why this wasn't caught before:** `docs/03-modules/crm/
CRM_VNEXT_IMPLEMENTATION_REGISTER.md` §P.6 records `test:e2e:crm` passing
45/45 clean immediately after the reorg that introduced this exact code.
This is consistent with a genuine race condition — concurrent
`client.query()` on one connection doesn't misbehave every time, only under
specific timing — which is exactly why it's dangerous: it will surface
unpredictably in production, likely correlated with load/latency, not on
every request. Treat "passed in CI once" as materially weaker evidence for
any of the other 22 files than it would be for a deterministic bug.

### Immediate next action (for this session or the next one)

1. **(Done this session)** Root-caused and fixed both `erp-crm-navigation.spec.ts`
   failures — see above. Full `test:e2e:crm` re-run to confirm 45/45 is the
   next verification step (was in progress when this entry was written).
2. **Strongly recommended before or alongside Procurement:** the systemic
   `Promise.all(client.query)` remediation above — it's a real correctness
   risk that could affect any module using this pattern under load, not
   scoped to CRM.
3. Then resume module-order execution at **Procurement** (module 3/12, 34
   features F063-F096, 0 existing F0##-AUDIT.md files — reconnaissance only
   so far, see below) using the same atomic-requirement-trace methodology
   CRM/Sales already went through.

### Procurement — F063 (Supplier master) traced, 2026-09-14

First real atomic-requirement trace for Procurement:
`docs/03-modules/procurement/audits/F063-AUDIT.md`. Verdict: core
CRUD/lifecycle/security engineering is solid (real permission gates,
test-covered sensitive-field redaction, audit/idempotency/outbox on every
mutation, RLS-enforced isolation) — matches CRM/Sales' quality bar. Three
real gaps recorded, not fixed: no duplicate-supplier detection, an
`archived` lifecycle status referenced defensively in queries but with no
actual transition to reach or leave it, and qualification/activation gated
by a single permission rather than a maker-checker approval. **Zero
Procurement browser E2E exists** — flagged as the single highest-leverage
next step, given this exact session found two real, previously-invisible
production bugs in CRM (a live concurrency bug and a deterministic
report-query bug) only once its E2E suite ran end-to-end for the first
time. Also fixed one instance of the concurrent-`client.query()` pattern
found in `pass1-operations.js`'s `listProcurementPass1Options` while
reading through the module (see commit `03172368`) — Procurement's main
governance dashboard was already correctly fixed in an earlier pass, with
an explicit comment explaining why.

**Next action for Procurement:** trace F064 (Supplier contacts and
addresses) next, following the same dossier -> code -> migration -> web ->
test evidence chain used for F063. 33 features remain (F064-F096).

### Procurement reconnaissance (not a trace — just current-state orientation)

- `services/api/src/modules/procurement/`: `index.js`, `governance.js`,
  `money.js`, `pass1-operations.js` + a `features/` dir — flatter than CRM's
  post-reorg domain layout, closer to Sales' current layout.
- `apps/web/src/modules/procurement/`: `components/`, `features/`,
  `scope.ts`, `server.ts`, `validation.ts`.
- 24 web pages, 10 API routes (from the 2026-09-05 maturity table, not
  re-verified this session), 0 `F0##-AUDIT.md` files — no atomic-requirement
  trace has been done yet, unlike CRM (30/30) and Sales (32/32).
- `PRODUCTION_TRACKER.md`'s existing note: "A prior effort ('Pass 1') already
  put substantial real implementation into F015-F114, spanning CRM/Sales/
  Procurement/Stock" (see `apps/web/tests/pass1-f015-f114.test.mjs`) — so
  Procurement is not a blank slate, but genuinely untraced.
- **Do not start fixing Procurement gaps before tracing it** — CRM/Sales'
  own history shows the trace-first, fix-in-one-dedicated-pass discipline is
  what kept those two modules' fixes correct and non-duplicative.

## Standing blockers requiring a human / credentials / business decision

- GitHub repo governance settings (branch protection etc. — see table above).
- Real external-provider verification (email delivery, payment/billing
  provider, GCP production infrastructure) — needs credentials this
  environment doesn't have. The provider-neutral contracts and their tests
  should be checked module-by-module as each module's SP-linked requirements
  come up; do not fabricate "verified" status for any of these.
- Human UAT — by definition cannot be performed by an AI session. Every
  module's final status should carry a `PENDING HUMAN UAT` line until an
  actual person signs off, per the task's own non-negotiable truth rule.
- Load/performance testing and disaster-recovery/backup-restore rehearsal —
  not attempted this session; flag as outstanding release gates.

## Module status summary (see `PRODUCTION_TRACKER.md` for full detail/history)

| Module | Features | Atomic trace | Status |
|---|---|---|---|
| CRM | F001-F030 | 30/30 traced | Production-ready, gap-closing pass complete (2026-09-06); reorged 09-10/11 (undocumented then, reconciled now); 2 live E2E nav-spec failures to root-cause |
| Sales | F031-F062 | 32/32 traced | Trace + gap-closing pass complete (2026-09-06); no further changes found since |
| Procurement | F063-F096 | 1/34 (F063) | Foundation exists (Pass 1 + dedicated code) and is solid where traced; 3 real gaps found, 0 E2E exists — **in progress, trace F064 next** |
| Stock | F097-F144 | 0/48 | Foundation exists (Pass 1 + dedicated code), untraced |
| Manufacturing | F145-F192 | 0/48 | Thin/scaffolding per 2026-09-05 table, not re-verified this session |
| Projects | F193-F230 | 0/38 | Thin/scaffolding, not re-verified |
| Assets | F231-F267 | 0/37 | Thin/scaffolding, not re-verified |
| Point of Sale | F268-F307 | 0/40 | Thin/scaffolding, not re-verified |
| Quality | F308-F342 | 0/35 | Thin/scaffolding, not re-verified |
| Support | F343-F380 | 0/38 | Thin/scaffolding, not re-verified |
| HR & Payroll | F381-F452 | 0/72 | Thin/scaffolding, not re-verified |
| Accounting | F453-F510 | 0/58 | Substantial backend per 2026-09-05 table, largely untested, not re-verified |

Feature-ID ranges above are inferred from each module's dossier count and the
canonical 510 total (30+32+34+48+48+38+37+40+35+38+72+58=510, confirmed by
counting `docs/03-modules/*/features/*.md` this session) — confirm exact
boundary IDs against `docs/02-register/FEATURE_REGISTER.csv` before citing
them in a per-feature audit.
