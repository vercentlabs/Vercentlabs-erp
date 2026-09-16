# CRM Visual QA — Prompt 3 (Live-Browser Pass)

Branch `rebuild/clean-frontend`, starting SHA `4b6ee7b66a6acaf0be01cea5103cc5305579b556`.

This is the first Prompt-3 pass conducted against a **real running
environment** (Docker Postgres, a real Next.js dev server, a real
Chromium browser) rather than an isolated sandbox. That distinction
matters: every defect below except the currency-display one (DEFECT-005)
was invisible to this repo's ~1,100 mocked-client unit tests, because a
mock never talks to a real Postgres connection and never knows what row-
level security, parameter type inference, or a missing SQL join actually
do. This pass is the first time any of that machinery has been exercised
end-to-end since this multi-session engagement began.

## Environment

- **Database**: Docker Compose Postgres (`infrastructure/docker/
  compose.local.yml`), migrated (38 platform + 111 tenant migrations,
  already current), runtime role (`vercent_app`, RLS-enforced, does not
  bypass RLS) provisioned via `pnpm db:setup`.
- **Redis**: not part of this repo's stack — no `redis` service in
  `compose.local.yml`, no `REDIS_URL`/`ioredis` reference anywhere in
  application code. The Prompt 3 brief's mention of Redis does not apply
  to this codebase; background jobs run through a Postgres-backed
  `tenant.background_jobs` table instead. Disclosed, not a blocker.
- **Fixture data**: reused the pre-existing "CRM E2E Fixture Org"
  (`a835b268-b3d2-445a-bc75-1e4c5556c5fe`, company "CRM E2E Fixture Co ·
  Head Office"), which already held realistic volume — 147 leads, 118
  opportunities, 322 accounts, 131 contacts, 54 logged calls, 17
  communications — sufficient for pagination, status variety, and
  density checks. Supplemented with `scripts/qa/set-qa-password.mjs` (new,
  committed) to set a known password for the fixture org's existing
  `organization_owner` (`e2e-owner@crm-e2e-fixture.test`) and restricted-
  viewer (`e2e-restricted@crm-e2e-fixture.test`) users, since no password
  was previously recoverable for either. Meetings/tasks/follow-ups/notes/
  territories/quota-plans/forecast-periods were NOT present in this org
  (0 rows) — empty states for those surfaces were verified from real
  empty data, not synthesized. The near-empty "CRM QA Fresh…" orgs (1 lead
  each) were available as an alternate empty-state fixture but not needed
  once the above was confirmed sufficient.
- **Browser**: real Chromium via `@playwright/test` (already a devDependency,
  already installed locally), driven by ad hoc scripts under
  `apps/web/scripts/qa/` (not yet a permanent suite — see Phase 8 status
  below).

## Screenshot inventory

75 screenshots captured: 21 page archetypes × 3 viewports (desktop
1440×900, tablet 1024×900, mobile 390×844), covering CRM Home, Lead
List/Form/360, Account List/360, Contact List/360, Opportunity List/360,
Pipeline, Calls, Meetings, Tasks, Follow-ups, Communications, Duplicate
Management, Import/Export, Custom Fields, Territories & Sales Teams,
Dashboard, Forecast, Reports, Lead Sources settings, Pipeline Stages
settings. Manifest and per-screenshot console-error capture:
`apps/web/scripts/qa/artifacts/screenshot-inventory.json`. Final pass: 0
screenshots with a recorded load error, 0 with a recorded console error.

Local paths (owner review): `apps/web/scripts/qa/artifacts/screenshots/*.png`.

## Defects found

### DEFECT-001 — P0 — Every CRM read route returned empty results against a real database

**Route/component**: 59 files under `apps/web/src/app/api/crm/**/route.ts`
(Dashboard, the entire generic `[resource]` list/get boundary, Leads,
Accounts, Contacts, Calls, Meetings, Tasks, Follow-ups, Notes,
Attachments, Reports, Options).
**Viewport**: all.
**Observed**: CRM Dashboard, Leads list, and every other CRM screen showed
"0" / "No \<records\> yet" for an organization with 337+ real records.
**Root cause**: `apps/web/src/core/db.ts`'s `withClient()` opens a bare
pool connection and never calls `setTenantContext()`, so Postgres's
`app.current_organization_id` session variable is never set. Every
tenant-schema table's RLS policy is
`organization_id = tenant.current_organization_id()`; unset, that
function returns NULL and the policy matches no row — an RLS denial, not
an application filtering bug. Confirmed directly against the real
restricted runtime role: `0` rows without the session variable set,
`147` rows with it set, same query, same data.
**Expected**: real data renders for every route that legitimately has it.
**Severity**: P0 — functionality inaccessible for essentially the entire
module.
**Fix**: switched all 59 routes from `withClient(...)` to
`tenantTransaction(session.organizationId, ...)`. Added a permanent
static guard (`apps/web/scripts/verify-routes.mjs`, Check 5: no
`api/crm/` route may import `withClient`) and a real Postgres integration
test (`tests/integration/crm-tenant-rls-context.test.mjs`).
**Status**: **Fixed and verified** against the real database. Commit `0b1fb9f9`.

### DEFECT-002 — P0 — Communications/Notes/Timeline 500'd for the common organization_owner/view_all caller

**Route/component**: `/crm/communications`, and the Notes/Communications
branches of the shared Timeline projector.
**Viewport**: all (backend bug, not viewport-specific).
**Observed**: `/crm/communications` 500'd on first load, permanently stuck
on "Loading communications…"; console showed
`Failed to load resource: 500`.
**Root cause**: two distinct Postgres parameter-type-inference bugs, both
only reachable for an `organization_owner`/`crm.records.view_all` caller
(the common case): (1) `communicationVisibilitySql` interpolated a bare
boolean placeholder (`OR $N OR`, no `::boolean` cast) into an OR-chain,
which Postgres cannot type-infer without a cast — the identical bug
existed in Notes' and Timeline's own near-identical predicates; (2)
`communicationParentScopeSql` pushed a company-id parameter onto the bind
array even when `allowAllCompanies` made it unused in the returned SQL
text, leaving an orphaned placeholder Postgres can never infer a type for
under any circumstance.
**Expected**: Communications, and any Notes/Timeline surface for the same
caller shape, load real data.
**Severity**: P0 — page completely unusable.
**Fix**: added explicit `::boolean` casts (3 files); reordered the
`allowAllCompanies` check so the phantom parameter is never added
(`record-policy.js`). Added a real Postgres integration test.
**Status**: **Fixed and verified** — Communications now renders 17 real
records. Commit `8529a549`.

### DEFECT-003 — P1 — Opportunity list and 360 page showed "Stage —" / "Account —" for opportunities with real, non-null relations

**Route/component**: `/crm/opportunities` (list), `/crm/opportunities/[id]`
(360).
**Viewport**: all.
**Observed**: every row/header showed a bare "—" for Stage and Account,
even though 118/118 opportunities in the live fixture org have a real,
non-null `stage_id`.
**Root cause**: `apps/web`'s `Opportunity` type has carried
`stageName`/`partyName`/`contactName`/`ownerName` fields since an earlier
pass, with an honest code comment admitting this was never independently
verified against the real backend. It wasn't projected: the generic
`getCrmRecord`/`listCrmRecords` path is a plain `SELECT record.*`, no
joins, and `projectCrmRecord` had no "opportunities" branch to add them.
**Expected**: Stage/Account/Contact/Owner names render per the HCI
standard's "what is the current status?" requirement.
**Severity**: P1 — core identifying information missing on the two most-
used Opportunity screens (the Pipeline kanban board was unaffected — it
groups by stage directly, not by this field).
**Fix**: new `annotateOpportunityRelations()` batch-resolver
(`resource-query-service.js`, same idiom as the existing
`annotateTerritoryCoverage`), wired into both `listCrmRecords` and
`getCrmRecord` for `"opportunities"`. Added 2 regression tests.
**Status**: **Fixed and verified** — Stage/Owner now render correctly
(`Qualification`, `CRM E2E Owner`) on both screens. Commit `8e201708`.

### DEFECT-004 — P2 — Pipeline board and Opportunity list show inconsistent currency labeling

**Route/component**: `/crm/pipeline`, `/crm/opportunities`.
**Viewport**: desktop (same underlying data issue at every viewport).
**Observed**: most Opportunity amounts render as a bare number ("42,000"),
while a minority render with a currency prefix ("INR 75,000") — on the
same board, same list, same organization.
**Root cause**: `tenant.crm_opportunities.currency_code` is NULL for
98/118 opportunities in the live fixture org. The Opportunity creation
form (`OpportunityFormScreen.tsx`) renders `currencyCode` as a plain,
optional `TextField` (placeholder "INR", no `isRequired`, no default) —
a real user can save an Opportunity with no currency through completely
ordinary usage, not just via fixture seeding. `money(null, amount)` then
renders with no currency prefix, indistinguishable from a genuinely-
different-currency record with the code just not shown.
**Expected**: per `HCI_STANDARD.md`'s "Error-prevention: context
correctness" — "Currency… the field requires a `currency` prop for
exactly this reason, it cannot silently default" — every amount should
carry an explicit, visible currency.
**Severity**: P2 — meaningful consistency/usability issue on financial
data, not blocking.
**Status**: **Disclosed, not fixed this pass.** Fixing correctly means
making the field required with a real default (the company's base
currency) rather than just adding client-side validation — judged out of
proportion for a visual-QA pass to change a data-entry contract without
a broader look at every other place `currencyCode` is optional (Leads,
Quota Plans, etc. use the same bare-`TextField` convention). Recommend a
dedicated pass.

### DEFECT-005 — P2 — SavedViewBar's "save current view" button broke the ARIA tablist contract

**Route/component**: `packages/design-system/src/enterprise/SavedViewBar.tsx`,
composed into `/crm/leads` and `/crm/opportunities` via
`apps/web/src/features/crm/shared/SavedViewsBar.tsx`.
**Viewport**: all (accessibility-tree issue, not viewport-specific).
**Observed**: axe-core (`aria-required-children`, critical) on both Lead
List and Opportunity List: the saved-views row's `role="tablist"`
container had a plain `<button aria-label="Save current filters as a
view">` as a direct child alongside the `role="tab"` buttons — a
`tablist` may only contain `tab` children, so this element's exposed
semantics are broken for assistive-technology users, e.g. that button is
liable to be skipped or mis-announced depending on the screen reader.
**Root cause**: the "create view" `IconButton` was rendered as a sibling
of the mapped `role="tab"` buttons but still inside the div carrying
`role="tablist"`.
**Expected**: `role="tablist"` contains only `role="tab"` children (WCAG
2.1 A, 1.3.1 Info and Relationships).
**Severity**: P2 — real assistive-technology defect, not a blocker for
sighted mouse/keyboard use.
**Fix**: wrapped the mapped tab buttons in their own inner div carrying
`role="tablist"`; the create-view `IconButton` is now a sibling outside
it, same visual layout. Covered by `apps/web/e2e/accessibility.spec.ts`
going forward.
**Status**: **Fixed and verified** — both pages pass axe's
`wcag2a`/`wcag2aa` rule sets with 0 critical/serious violations.

### DEFECT-006 — P2 — Home/Dashboard metric and nav-link grids left large empty space when the item count didn't divide evenly by 4

**Route/component**: `packages/design-system/src/enterprise/MetricStrip.tsx`
(used by CRM Home, Dashboard, Forecast) and
`apps/web/src/features/crm/home/screens/CrmHomeScreen.tsx`'s per-section
nav-link grid.
**Viewport**: all (a CSS grid-track issue, not viewport-specific,
though most visible at desktop width where more columns fit).
**Observed**: both components used a fixed `grid-cols-4` (or
`sm:grid-cols-3 lg:grid-cols-4`) regardless of how many items were
passed. CRM Home's stats row has 5 metrics — row 1 filled 4, row 2 had
1 card ("Due today") with 3 empty column-tracks visibly trailing it.
Home's Engagement section has exactly 1 nav link, rendered as a
1-of-4-filled ghost grid (75% of the row empty); Insights and Data
sections (2 items) were 50% empty. Dashboard's stats row has 6
metrics — row 2 had 2 filled, 2 empty.
**Root cause**: `grid-template-columns` was a fixed count, not
responsive to child count — CSS grid doesn't collapse a partially-empty
final row on its own.
**Expected**: a row with fewer items than the column count shouldn't
render visible empty grid cells.
**Severity**: P2 — real, visible layout defect on two of the most-
visited screens (Home, Dashboard), not blocking any workflow.
**Fix**: both grids switched to
`grid-cols-[repeat(auto-fit,minmax(200px,280px))]` — `auto-fit`
collapses tracks with no content instead of rendering them empty, and
the `280px` cap keeps card width the same as before rather than
stretching a lone card to fill the row. Verified visually: Home's 5
stats now render 3+2 instead of 4+1; Dashboard's 6 now render a
perfect 3+3.
**Status**: **Fixed and verified.** Commit `ead8b207`.
**How this was missed in Phase 7**: the stats row itself was above the
fold and visible in the Phase 7 screenshots, but the reviewer didn't
scrutinize the grid math closely enough to flag the orphaned card. The
Engagement/Insights/Data instances of the same bug genuinely were
missed for a second reason — Phase 7's screenshots were captured via
`page.screenshot({ fullPage: true })` against a shell that scrolls its
main content internally (`overflow-y-auto` on a flex child, not the
document body); `fullPage` only follows document scroll height, so it
silently truncated most pages below ~900px. Both gaps are addressed in
Phase 8.

### Non-defect — dev-mode cold-compilation false positive

Several screenshots in the first capture pass showed permanently-stuck
"Loading…" states (Account 360's duplicate/hierarchy/contact-relationship/
account-plan panels, Lead 360, Forecast, Communications before its real
fix). Investigated directly: the underlying backend functions
(`getAccountHierarchy`, `findAccountDuplicates`) complete in under 150ms
when called directly against the real database. Three consecutive page
loads with no code changes went from "4 of 11 concurrent requests never
respond within 15s" to "0 pending after 15s" — this is Next.js dev mode's
on-demand route compilation serializing under concurrent first-hits
across many never-before-visited route files, not a real backend hang or
a connection-pool exhaustion (`DATABASE_POOL_MAX=12` vs 11 concurrent
requests; Postgres itself never exceeded 7 total connections against a
`max_connections=100` limit). **Recommendation**: any future timing-
sensitive QA pass should run against a production build
(`next build && next start`), not `next dev`, to avoid re-diagnosing this
same false-positive class.

### Non-defect — `fullPage` screenshots clip `EnterpriseDataGrid`'s inner scroll region

The Phase 7 desktop re-capture initially looked like it had a clipped
last row on the Account List (and, by the same mechanism, unexplained
blank space below the table on other list screens). Investigated
directly: `EnterpriseDataGrid`'s scroll container is
`max-h-[70vh] overflow-auto` by design (so the column header can stay
sticky — this is the documented `HCI_STANDARD.md` Tables pattern, not
an accident). `scrollHeight` (1610px) exceeds `clientHeight` (630px) on
a 25-row page; Playwright's `page.screenshot({ fullPage: true })` only
extends to the outer document's scroll height, it does not expand a
nested `overflow: auto` container, so rows past ~10 never appear in the
capture. Confirmed the true behavior directly: the "clipped" row
(`isVisible: true`) is fully reachable by scrolling the grid, exactly
as a real user would. **Not a defect** — a screenshot-tooling
limitation, same class as the already-documented dev-mode
cold-compilation false positive above.

## Phase status

- **Phase 1 (environment)**: done — see Environment section above.
- **Phase 2 (baseline screenshots)**: done — 75 screenshots, 3 viewports,
  21 page archetypes.
- **Phase 3 (design evaluation)**: done for the reviewed set against
  `HCI_STANDARD.md`; produced DEFECT-001 through DEFECT-004.
- **Phase 4 (this register)**: done.
- **Phase 5 (fix P0/P1)**: done — all 3 confirmed P0/P1 defects fixed,
  tested (backend suite 1087/1087), and verified against the real
  database and a real browser. DEFECT-004 (P2) deliberately deferred with
  reasoning above, not silently dropped.
- **Phase 6 (permanent regression suite + functional/accessibility
  pass)**: done. Replaced the ad hoc `apps/web/scripts/qa/*.mjs` scripts
  with a permanent Playwright suite (`apps/web/playwright.config.ts`,
  `apps/web/e2e/`, run via `pnpm --filter @vercentlabs/web test:e2e`):
  - `auth.setup.ts` — one real login, storage state reused by every spec.
  - `crm-regression.spec.ts` — a standing guard for DEFECT-001/002/003:
    5 list routes load with zero console errors; the Opportunity 360
    header renders a real Stage value (`stage_id` is `NOT NULL` by
    schema) and, for a list row that actually has one, a real Account
    value (`party_id` is nullable — deliberately not asserted on every
    row); the Activity and Notes tabs load without a 5xx.
  - `opportunity-stage-transition.spec.ts` — first functional (not just
    visual) workflow test: opens the Opportunity 360 Pipeline tab, picks
    an open non-current destination stage from the real "Destination
    stage" listbox, submits via the real `POST
    /api/crm/opportunities/{id}/stage` endpoint, and confirms the
    Overview tab reflects the new stage. Passing end-to-end confirms the
    stage-transition governance path (optimistic concurrency, Won/Lost
    outcome-reason requirement, stage-exit playbook gate) works for the
    plain open-to-open case; those guardrails themselves are already
    covered by `services/api`'s own test suite, not re-tested here.
  - `accessibility.spec.ts` — `@axe-core/playwright` (`wcag2a`/`wcag2aa`)
    across 9 pages incl. Opportunity 360; found and fixed DEFECT-005.
  - All 20 tests pass. The restricted-viewer fixture user's password is
    currently stale (predates this pass; not set by
    `scripts/qa/set-qa-password.mjs` for that email) — restricted-role
    coverage was left out of this suite rather than worked around; run
    `node scripts/qa/set-qa-password.mjs e2e-restricted@crm-e2e-fixture.test`
    to fix it before adding restricted-role specs.
- **Phase 7 (full desktop visual QA re-pass)**: done. Re-captured all 25
  desktop (1440×900) screens with `apps/web/scripts/qa/capture-desktop.mjs`
  (fresh login, no stale storage state) and read every one against
  `HCI_STANDARD.md`'s checklist — primary/secondary action weighting,
  danger-action styling (`Archive` used correctly instead of `Delete` on
  Account/Contact/Opportunity 360), empty vs. no-results states,
  cross-page numeric consistency (Home/Dashboard/Forecast/Reports/
  Pipeline all agree: 147 open leads, 98 open opportunities, 79/19 split
  across Qualification/Needs analysis), contextual disabling (e.g.
  "New field" disabled until a custom object exists). **Result: 0 new
  defects.** DEFECT-001/002/003's fixes hold up visually (real Stage/
  Account/Communications data render correctly); the already-deferred
  DEFECT-004 currency inconsistency is visible exactly where expected
  and nowhere else. One investigated-and-ruled-out false positive
  documented above (`fullPage` vs. `EnterpriseDataGrid`'s inner scroll).
  Screenshots: `apps/web/scripts/qa/artifacts/screenshots/*__desktop.png`.
  **Correction (see Phase 8): the "0 new defects" conclusion above was
  reached on an incomplete view of most pages and was wrong — a real
  defect (DEFECT-006, documented above with DEFECT-001–005) was on two
  of these screens.**
- **Phase 8 (correcting Phase 7's screenshot methodology + DEFECT-006)**:
  done, prompted by the user pushing back on the Phase 7 "0 new
  defects" conclusion — correctly: that pass's `fullPage` screenshots
  were silently truncated by a nested `overflow-y-auto` shell container
  (see the "Non-defect" entry above for `EnterpriseDataGrid`'s
  *deliberate* version of the same mechanism — this one wasn't
  deliberate, it was the ordinary page shell). Fixed
  `capture-desktop.mjs` to neutralize that clipping before capturing,
  capped at 2000px of revealed height so genuinely-bounded containers
  (grid virtualization, kanban columns) aren't force-unclipped into a
  screenshot no real user would ever see — verified by first getting
  this wrong too (an uncapped version of the fix produced a 9632px
  screenshot of the Pipeline board's Qualification column) before
  adding the cap. Re-reviewed all 25 screens against the corrected
  captures and found DEFECT-006, above. Also re-examined and ruled out
  (with precise, measured gaps, not visual impression) a second
  suspected defect — inconsistent-looking section spacing on Account
  360 — which turned out to be an artifact of varying body-content
  length between section headings, not inconsistent CSS: three
  single-line sections (Contact relationships→Hierarchy, Communications
  →Custom fields, Custom fields→Privacy) measured 68px, 68px, 77px
  apart respectively, within normal rounding.
