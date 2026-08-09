# ERP Shared Workspace Foundation — Prompt 8

Home Dashboard, Master Data, My Work, Tasks, Follow-ups & Reminders, Exceptions, Recent Records, and Favourites.

## 1. Executive Summary

Prompt 8 adds a shared-workspace layer on top of the module-gated foundation established in Prompts 1-7: a role-aware Home dashboard "Attention" section, a strengthened Master Data workspace, and six new real routes (`/my-work`, `/tasks`, `/follow-ups`, `/exceptions`, `/recent`, `/favourites`). None of this is a new authorization surface — every source adapter re-uses an existing module-gated session helper (`crmApiContext`, `projectsContext`, `accountingContext`, `procurementContext`, `supportContext`, `qualityContext`) and an existing secured list/dashboard function. Two small new control-plane tables (`favourites`, `recent_records`) back genuinely new, previously-nonexistent persistence; nothing else required schema changes.

## 2. Non-Negotiable Architectural Principle (restated, and how it was enforced)

`SOURCE MODULE DATA → MODULE ACCESS → ACTION PERMISSION → COMPANY/BRANCH/RECORD SCOPE → SHARED WORKSPACE AGGREGATION`. Concretely: every adapter in `apps/web/src/lib/my-work/*` calls `assertModuleAccessible()` (directly or via a module's own `*Context()`/`*Session()` helper) before touching data, then calls that module's own already-secured list/dashboard function (`listCrmRecords`, `listProjectResource`, `listSupportResource`, `listQualityResource`, `getReceivablesGovernanceDashboard`, `getPayablesGovernanceDashboard`, `getBankingGovernanceDashboard`, `getProcurementGovernanceDashboard`). No adapter issues a raw `client.query()` against a module's own tables (enforced by `tests/shared-workspace.test.mjs`). Favourites/Recent Records add one more link: a stored href is re-validated for current module accessibility on every read (`resolveModuleAccess`), never trusted as authorization by itself.

## 3. Why the New Nav Items Carry No Permission Gate

`/my-work`, `/tasks`, `/follow-ups`, `/exceptions`, `/recent`, `/favourites` have no `permission:` on their `NavigationItem`. This is deliberate, not an oversight: each page aggregates only what the caller's existing per-source checks already allow. A user with no accessible sources simply sees empty states, the same outcome a permission gate would produce, without adding a second, potentially-inconsistent gate to keep in sync with the per-source checks underneath.

## 4. Home Dashboard — What Changed

`apps/web/src/app/(app)/dashboard/page.tsx` already had zero fake KPIs (all 6 metric-grid tiles and the audit-events panel were confirmed real before this prompt). Two additions:

- A new **Attention** section (before Organisation overview) rendering 4 metric cards — Tasks overdue/due today, Follow-ups due today, Open exceptions, Pending approvals — sourced from `getMyWorkSummary(session, 5)`.
- A new **Recent records / Favourites** two-panel section at the bottom, sourced from `listRecentRecords`/`listFavourites`.

The pre-existing Organisation overview, Quick actions, Your open activities, and Latest audit events sections are untouched.

### Home Widget Table

| Widget | Source | Module | Permission | Link |
|---|---|---|---|---|
| Tasks overdue/due today | `listMyTasks()` (CRM activities + project tasks) | crm, projects | module-gated only | `/tasks` |
| Follow-ups due today | `listMyFollowUps()` (CRM leads, `next_follow_up_at`) | crm | module-gated only | `/follow-ups` |
| Open exceptions | `listMyExceptions()` (6 sources, see §9) | accounting, procurement, support, quality | module-gated only | `/exceptions` |
| Pending approvals | `listMyApprovals()` | platform | `approvals.manage` | `/approvals` |
| Recent records | `listRecentRecords()` | varies per row | re-validated per row | varies |
| Favourites | `listFavourites()` | varies per row | re-validated per row | varies |
| Unread notifications (pre-existing) | `notifications` table count | platform | none | `/notifications` |
| Companies/Branches/Users/Departments/Roles (pre-existing) | control-plane counts | platform | per-tile | `/settings/*` |

## 5. Master Data — What Changed

`apps/web/src/lib/business-data.ts`'s 16-resource registry and CRUD architecture are unchanged. Two additions to `apps/web/src/app/(app)/master-data/page.tsx`:

1. **Client-side catalogue search** (`apps/web/src/components/master-data-catalogue.tsx`) — filters the already-fetched, already-permission-scoped `entries` array by title/description/group. No server round-trip per keystroke; the component never re-derives `businessDataDefinitions` itself, it only filters the props the server passed down.
2. **Permission-aware "Manage access" / "View only" badge per card** — all 16 resources share one read gate (`businessDataView`, confirmed uniform by audit — there is no per-resource *view* permission to split further on), but their *manage* permissions genuinely differ (`partiesManage`, `itemsManage`, `inventorySetupManage`, `financeSetupManage`). Each card now reflects `hasPermission(session, definition.managePermission)` individually rather than assuming uniform write access.

Module-specific workflows (Procurement supplier onboarding/risk/approvals, etc.) were not touched or duplicated into Master Data — Master Data still exposes only the shared record.

## 6. My Work — `/my-work`

A single overview page aggregating: Tasks, Follow-ups & Reminders, Exceptions, and Approvals (top 5 each, via `getMyWorkSummary`), plus Recent Records and Favourites previews (top 5 each). Every metric card links to its full workspace. No new data source — purely a composition of the adapters described below.

## 7. Tasks — `/tasks`

**Model decision**: no cross-module tasks table exists (confirmed by repo-wide audit — every "task" concept is module-specific). This is a read-oriented aggregation, not a schema unification. Views: My tasks / Overdue / Due today / Upcoming, via `?view=` query param (validated against a fixed allowlist — `resolveView()` falls back to `"all"` for any unrecognized value, never passed to SQL).

### Tasks Source Table

| Source | Module | Task Type | Security | Mutation Support |
|---|---|---|---|---|
| `tenant.crm_activities` (assignedTo = me, open) | crm | Activity (call/meeting/generic) | `crmApiContext()` → `assertModuleAccessible("crm")`; row-level via `listCrmRecords`'s existing `recordScope()` | Read-only (link to source lead/opportunity/contact) |
| `tenant.project_tasks` (assignee_user_id = me, open) | projects | Project task | `assertModuleAccessible("projects")` + `projectsContext()` (company-scoped) | Read-only (link to `/projects/tasks`) |

Both are fetched via `Promise.allSettled` in `listMyTasks()`; a failing source is omitted, never fails the page.

## 8. Follow-ups & Reminders — `/follow-ups`

Single source: `tenant.crm_leads` rows with `nextFollowUpAt` set, owned by the caller (`ownerUserId === session.userId`), excluding `converted`/`unqualified` leads. Deliberately kept separate from Tasks (a different underlying table, `crm_leads` not `crm_activities`) so the same rows are never double-counted across both workspaces. Same Overdue/Due today/Upcoming views as Tasks.

## 9. Exceptions — `/exceptions`

Only categories with a real, already-computed source were implemented; nothing was fabricated for symmetry.

### Exceptions Source Table

| Category | Source | Module | Status |
|---|---|---|---|
| Finance exception — collections | `getReceivablesGovernanceDashboard().collectionCases` (`tenant.accounting_collection_cases`) | accounting | Implemented (reused verbatim) |
| Finance exception — payables | `getPayablesGovernanceDashboard().exceptionCases` (`tenant.accounting_payables_exception_cases`) | accounting | Implemented (reused verbatim) |
| Finance exception — reconciliation | `getBankingGovernanceDashboard().exceptionCases` (`tenant.accounting_reconciliation_exception_cases`) | accounting | Implemented (reused verbatim) |
| Workflow exception — procurement | `getProcurementGovernanceDashboard().exceptionCases` (`tenant.procurement_governance_exception_cases`) | procurement | Implemented (reused verbatim) |
| SLA breach | `listSupportResource(..., "tickets")` + in-process breach filter (mirrors `getSupportDashboard()`'s own count condition) | support | Implemented (new filter over an existing secured list) |
| Quality hold | `listQualityResource(..., "holds")` + `status='active'` filter | quality | Implemented (new filter over an existing secured list) |
| Stock exception (low-stock/negative-stock/expired-batch) | — | stock | **Not implemented.** Real underlying columns exist but no existing query computes any of these three conditions; a correct warehouse-aware low-stock join was judged out of scope for this prompt. Documented gap, not fabricated. |
| Accounting close-task blockers | — | accounting | **Not implemented.** Explicitly confirmed absent by the Prompt 8 audit. |
| Failed workflow executions | — | platform | **Not implemented.** Explicitly confirmed absent. |
| Payment/posting failures | — | accounting | **Not implemented.** Explicitly confirmed absent. |

The four "governance dashboard" reuses add **zero new SQL** — they call the exact function each area's own dashboard page already calls and extract the exception-case list already present in its return value. The two "existing secured list + filter" reuses add an in-process JS filter only, over rows already fetched through the module's existing access-controlled list function.

Categories tabs on `/exceptions` are computed client-side (server-rendered) from the `id` prefix of each returned `WorkItem` (`sla-breach:`, `quality-hold:`, `receivable-exception:`/`payable-exception:`/`reconciliation-exception:`, `procurement-exception:`) — no separate query per tab, so tab counts and the "all" list can never disagree.

## 10. Approvals and Notifications — Integration, Not Rebuild

`apps/web/src/lib/my-work/approvals.ts` (`listMyApprovals`) and `apps/web/src/lib/my-work/notifications.ts` (`listMyNotifications`, `countUnreadNotifications`) extract the exact SQL `apps/web/src/app/api/approvals/route.ts`'s GET and `apps/web/src/app/api/notifications/route.ts`'s GET already ran inline, so both the existing API routes and the new My Work/Home pages call one shared, still-identically-scoped function. Scoping is unchanged: approvals to `(assigned_to = me OR assigned_to IS NULL)` gated by `approvals.manage`; notifications to `(organization_id, user_id)`. Neither endpoint gained new capabilities.

## 11. Recent Records — `/recent`

**Persistence decision**: a new, small control-plane table, `recent_records` (migration 029). `audit_events` was ruled out — confirmed immutable (DB trigger) and mutation-only by convention (57 real event-type call sites, zero "viewed" events); repurposing it would both pollute the governance trail and require an index shape it doesn't have. `user_preferences` was ruled out — fixed-column, one-row-per-user shape with no room for an open-ended per-entity list.

Tracking happens **server-side**, inside the record-detail page itself, only after the record has already been fetched successfully under that page's own existing access control (`trackRecentRecord()` in `apps/web/src/lib/recent-records.ts`) — never a client-side fire-and-forget from an arbitrary href. Wired into two representative, high-traffic record pages this pass: CRM lead detail and CRM opportunity detail (`apps/web/src/app/(app)/crm/leads/[id]/page.tsx`, `.../opportunities/[id]/page.tsx`). Extending this to the remaining ~15 record-detail routes (Sales orders, Procurement suppliers, Accounting journals, etc.) is a documented, low-risk follow-up, not attempted in this pass to keep the change set reviewable.

Reads are bounded (`LIMIT 30`, capped at 50 in the query), re-validate module accessibility per row, and de-duplicate via `UNIQUE (organization_id, user_id, target_href)` with an `ON CONFLICT ... DO UPDATE SET viewed_at = now()` upsert — a repeat visit moves the row to the top, it never creates a duplicate.

## 12. Favourites — `/favourites`

**Persistence decision**: a new control-plane table, `favourites` (migration 029), same `(organization_id, user_id)` ownership pattern as `user_preferences`, same reasoning for not reusing existing tables as §11.

**Target validation** (`apps/web/src/lib/internal-href.ts`, shared by both Favourites and Recent Records): `isValidInternalHref()` rejects anything that isn't a same-origin relative path starting with a single `/`, containing no whitespace/quote/angle-bracket characters, no `scheme:` prefix (blocks `/javascript:...`), and whose first path segment is one of the 12 real module keys (sourced from `ERP_MODULE_CATALOG`, not a second hand-maintained list) or a known shared-workspace/platform area. This runs at **write** time, independent of the writing user's current access (per-user accessibility is re-checked separately on every read).

**API**: `GET /api/favourites`, `POST /api/favourites`, `DELETE /api/favourites` only — no PUT/PATCH. `POST`/`DELETE` assert same-origin; all three require an authenticated session.

**UI**: one deliberate control (`apps/web/src/components/favourite-toggle.tsx`), wired into the same two CRM record pages as Recent-record tracking, plus a remove control on the `/favourites` workspace itself (`favourites-list.tsx`). Not scattered across every page — matches the "restrained UI" requirement.

## 13. Database Migration

`database/control-plane/migrations/029_shared_workspace_favourites_and_recents.sql` — two tables, `favourites` and `recent_records`, both `(organization_id, user_id)`-owned, both with a `UNIQUE (organization_id, user_id, target_href)` constraint and a supporting index. Applied directly to the running local Postgres (`docker exec vercentlabs-postgres psql ... < 029_...sql`) — confirmed `CREATE TABLE`/`CREATE INDEX` x2/`COMMIT`.

## 14. Navigation Registry

`apps/web/src/lib/navigation/my-work.ts` gained 6 items (`/my-work`, `/tasks`, `/follow-ups`, `/exceptions`, `/recent`, `/favourites`) ahead of the existing Notifications/Approvals items, each with the documented command-palette keyword aliases: `todo`/`to-do` → Tasks, `reminder`/`reminders` → Follow-ups, `issues`/`issue` → Exceptions, `recent` → Recent records, `saved`/`favorites`/`starred` → Favourites. `apps/web/scripts/verify-routes.mjs`'s existing href-resolution check (unmodified) confirms all 6 resolve to a real `page.tsx` — 127 navigation hrefs checked, 0 failures.

## 15. WorkItem Aggregation Architecture

`apps/web/src/lib/my-work/types.ts` defines the shared `WorkItem` shape (`id, kind, moduleId?, source, title, subtitle?, dueAt?, urgency, priority?, status?, href`) and `classifyDueAt()` — a plain three-way overdue/due_today/upcoming/none classifier using the server's local calendar day boundaries (not a blind UTC-midnight comparison). Every adapter (`tasks.ts`, `follow-ups.ts`, `exceptions.ts`) maps its module's rows into this shape; `aggregate.ts`'s `getMyWorkSummary()` composes all sources plus approvals/notifications via `Promise.allSettled`, slices each to a small preview count, and derives its summary counts (`tasksOverdue`, `followUpsDueToday`, `exceptionsOpen`, `approvalsPending`) from the exact same classified lists returned to callers — so Home's counts and `/tasks`/`/follow-ups`/`/exceptions`'s own filtered views can never disagree (both filter the same `listMyTasks()`/`listMyFollowUps()`/`listMyExceptions()` output by the same `urgency` field). No "attention score" — plain counts only.

## 16. Query Parameter Validation

`/tasks?view=`, `/follow-ups?view=`, `/exceptions?category=` are each validated against a small fixed allowlist (`resolveView()`/`resolveCategory()`) with a safe fallback to the default view for any unrecognized value — never interpolated into SQL (none of these adapters accept a client-supplied sort/filter column at all; filtering happens in JS over an already-fetched, already-bounded result set).

## 17. Performance and Bounding

Every adapter caps its underlying fetch (100-200 rows) before an in-process filter/slice, and every page/preview further slices to a small display count (5 for Home/My Work previews, 50 for the dedicated Tasks/Follow-ups/Exceptions pages). No adapter result set is unbounded. `getMyWorkSummary` and each adapter run their sub-sources via `Promise.allSettled`, never a single giant cross-table query.

## 18. Fail-Closed Behavior

Every adapter function is wrapped in its own `try/catch`, returning `[]` on any failure (module inaccessible, missing active company, DB error) — never falling back to an unscoped query and never throwing up into the page (which would otherwise take down the whole aggregation for one failing source). Verified by `tests/shared-workspace.test.mjs`'s static catch-block scan.

## 19. Sensitive-Data Boundaries Preserved

- HR & Payroll is never queried by any Exceptions/Tasks/Follow-ups adapter (grepped, zero matches).
- The SLA-breach adapter reads via `listSupportResource(..., "tickets")`, never `support_communications` directly — the existing `private_note` redaction inside `listSupportResource` is inherited automatically, not re-implemented or bypassed.
- CRM adapters call `listCrmRecords()`/`crmApiContext()` exclusively — Prompt 3's ownership/record-scope logic (`recordScope()`) is inherited, never bypassed with a raw `crm_activities`/`crm_leads` query.

## 20. Timezone Handling

`classifyDueAt()` compares against the server process's local calendar day (`new Date(y, m, d)` start-of-day boundaries), not `date::text = current_date` string comparison or a UTC-midnight cutoff — the specific anti-pattern this prompt's spec called out to avoid. This matches the existing codebase's own convention of comparing dates without per-user timezone conversion (e.g. `current_date` in the support/CRM dashboards); a full per-user-timezone rework was out of scope.

## 21. Files Changed

**New:**
- `database/control-plane/migrations/029_shared_workspace_favourites_and_recents.sql`
- `apps/web/src/lib/internal-href.ts`
- `apps/web/src/lib/favourites.ts`, `apps/web/src/lib/recent-records.ts`
- `apps/web/src/lib/my-work/{types,tasks,follow-ups,exceptions,approvals,notifications,aggregate}.ts`
- `apps/web/src/app/(app)/{my-work,tasks,follow-ups,exceptions,recent,favourites}/page.tsx`
- `apps/web/src/app/api/favourites/route.ts`
- `apps/web/src/components/{work-item-list,favourite-toggle,favourites-list,master-data-catalogue}.tsx`
- `apps/web/tests/shared-workspace.test.mjs`

**Modified:**
- `apps/web/src/app/(app)/dashboard/page.tsx` — Attention + Recent/Favourites sections added
- `apps/web/src/app/(app)/master-data/page.tsx` — delegates card rendering to `MasterDataCatalogue`
- `apps/web/src/app/(app)/crm/leads/[id]/page.tsx`, `.../crm/opportunities/[id]/page.tsx` — Favourite toggle + Recent tracking wired in
- `apps/web/src/app/api/approvals/route.ts`, `apps/web/src/app/api/notifications/route.ts` — delegate to shared `my-work/*` helpers
- `apps/web/src/lib/navigation/my-work.ts` — 6 new items + keyword aliases
- `apps/web/src/app/globals.css`, `apps/web/src/app/business-data-extension.css` — supporting styles (`.timeline-list > a`, `.tab-strip`, `.favourite-toggle`, `.master-data-search`, `.master-data-card-access`)
- `apps/web/tests/context-and-topbar.test.mjs` — updated to follow the notifications-route refactor

## 22. Tests

`apps/web/tests/shared-workspace.test.mjs` — 36 new tests covering: `classifyDueAt` behavior (real execution, not just source inspection), `isValidInternalHref` accept/reject cases (real execution), fail-closed adapter behavior, module-gated session reuse, no-raw-SQL, documented Stock Exceptions gap, `Promise.allSettled` usage, summary/list count consistency, Favourites/Recent access re-validation and target validation, API route auth/origin checks, navigation registry entries + keyword aliases + no redundant permission gate, Approvals/Notifications de-duplication, dashboard integration + no placeholder markers, Master Data client-side search + per-resource manage badge, and 4 security-regression checks (CRM ownership, HR/payroll invisibility, support private-note redaction, module-access fail-closed invariant unaffected).

One pre-existing test (`context-and-topbar.test.mjs`) was updated (not weakened) to follow the notifications-route SQL into its new shared-helper location while still asserting the same `(organization_id, user_id)` scoping property.

## 23. Verification Results

- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web lint` — 0 errors (1 pre-existing, unrelated warning).
- `apps/web/scripts/verify-routes.mjs` — 122 pages, 281 routes, 127 navigation hrefs (incl. the 6 new ones), 9 Quick Create hrefs, 4 static destinations — all resolve, 0 failures.
- `pnpm --filter web test` — **181/181 passing** (145 pre-existing + 36 new), 0 failures.
- `pnpm --filter web build` — succeeds; all 6 new routes plus `/api/favourites` present in the route manifest.
- `pnpm verify` (typecheck + lint + test:web + test:api + verify:routes + verify:mobile + verify:db + test:sdk + test:packages + test:integration + test:security + test:enterprise-rbac) — **passes clean, exit 0**.
- `pnpm release:verify` — see the final chat response for the completed result (run in background due to its length; landing-only steps, if any fail, are reported separately from ERP results per the standing instruction not to assume Prompt 7's specific landing-e2e failure signature recurs).

## 24. Remaining Risks / Follow-ups (not fixed in this pass, by design)

- **P2** — Recent-record/Favourite tracking is wired into 2 of ~17 record-detail page types (CRM leads/opportunities). Extending to Sales/Procurement/Accounting/Support/Quality/Assets/Projects detail pages is straightforward (same two-line pattern) but was scoped down to keep this change set reviewable.
- **P2** — Stock Exceptions (low-stock/negative-stock/expired-batch) has real underlying columns but no existing query; a correct warehouse-aware join was judged out of scope.
- **P3** — Command palette does not yet surface a favourite/unfavourite affordance inline in record search results (only the two wired detail pages and the `/favourites` workspace itself have the control) — the palette's existing button-per-result markup would need a delegated secondary action to add this without invalid nested-button HTML.
- **P3** — `classifyDueAt` uses the server process's local time, not each user's own stored timezone (`user_preferences.timezone` exists but isn't consulted here) — acceptable given the rest of the codebase's dashboards follow the same convention, but a true per-user-timezone pass would improve accuracy for users outside the server's zone.

## 25. Adversarial Review (Part 83)

1. **Can Home leak a KPI from an inaccessible module?** No — every Attention-section number comes from `getMyWorkSummary()`, whose adapters each assert module accessibility before querying; an inaccessible module's adapter returns `[]`/0.
2. **Can a cross-module work-item leak to an unauthorized user?** No — every adapter's read path is the module's own already-secured list/dashboard function; nothing bypasses `recordScope()`/`companyScope()`/permission checks.
3. **Can CRM ownership scoping be bypassed via aggregation?** No — `tasks.ts`/`follow-ups.ts` call `listCrmRecords()` exclusively (verified: zero raw `tenant.crm_*` queries in either file); ownership filtering (`assignedTo`/`ownerUserId === session.userId`) is applied *in addition to*, not instead of, `recordScope()`.
4. **Can HR-sensitive data leak via a task title?** No — no adapter queries HR & Payroll tables at all (grepped, zero matches in `exceptions.ts`/`tasks.ts`/`follow-ups.ts`).
5. **Can supplier financial data leak via Exceptions?** The procurement exceptions adapter surfaces `reason_code`/`entity_type`/`company_name` only — no banking/financial fields from `procurement_governance_exception_cases`, which doesn't store any.
6. **Can a Support private note leak?** No — the SLA-breach adapter calls `listSupportResource(..., "tickets")`, never selects `support_communications`; the table's own private-note redaction is untouched and inherited.
7. **Can Recent/Favourites leak a record after permission is revoked?** No — both `listFavourites()` and `listRecentRecords()` call `resolveModuleAccess()` per row on every read and drop inaccessible rows.
8. **Can an arbitrary URL be favourited?** No — `isValidInternalHref()` rejects anything not shaped like a real internal route (external URLs, `//`, `javascript:`, unknown top-level segments all rejected; tested directly).
9. **Can one user read another user's Recent/Favourites?** No — every query is `WHERE organization_id=$1 AND user_id=$2` bound to the caller's own session values.
10. **Does a company/branch switch leave stale data visible?** Partially mitigated: Favourites/Recent Records are user-level (not company/branch-scoped by design, like `user_preferences`), but the destination page's own existing company/branch scoping is the final authority on render — a stale favourite to a different-company record will 404/403 at the destination, not leak data via the favourites list itself (the list only ever shows label + href, no record payload).
11. **Can an adapter fail open?** No — every adapter is wrapped in `try/catch` returning `[]` (statically verified across `tasks.ts`, `follow-ups.ts`, `exceptions.ts`).
12. **Can an inaccessible record inflate a count?** No — counts are derived from the same post-filter, post-access-check `WorkItem[]` returned to the list views; there is no separate unfiltered count query.
13. **Can Home's metric and the filtered list view disagree?** No — both consume the same adapter output and the same `urgency` classification; no divergent SQL/definition exists.
14. **Is there a SQL-injection path via `?view=`/`?category=`?** No — both are validated against a fixed allowlist and never reach SQL; filtering happens in JS over an already-fetched result.
15. **Can a result set be unbounded?** No — every adapter caps its underlying fetch (100-200) and every display path further slices (5-50).
16. **Are there residual fake KPIs?** No — verified by both a targeted test (no `Math.random`/`TODO`/`FIXME`/`dummy`/`sample data` in `dashboard/page.tsx`) and by construction (every new number traces to a real adapter).
17. **Can Master Data's search bypass permission filtering?** No — the client component only filters the `entries` array the server already computed with `hasPermission()` checks baked in; it never re-derives the catalogue or fetches anything itself.
18. **Can a module-specific workflow be mistaken for Master Data?** No new workflow content was added to Master Data; only the existing 16 shared-record resources remain listed.
19. **Can a notification/approval ID bypass its source's own authorization?** No — `listMyApprovals()` still requires `approvals.manage` and still scopes to `(assigned_to = me OR NULL)`; `listMyNotifications()` still scopes to `(organization_id, user_id)`. Both are the exact pre-existing queries, relocated not rewritten.
20. **Can a module badge/metadata leak an inaccessible module's existence?** No — `WorkItem.moduleId` is only ever set on items that already passed that module's own `assertModuleAccessible()` check inside the adapter that produced them.
21. **Can the Favourites API be used to enumerate other users' data?** No — `GET`/`DELETE` are both scoped to the caller's own `(organization_id, user_id)`; there is no lookup-by-arbitrary-ID path.
22. **Can `trackRecentRecord()` be called with an unchecked href from client input?** No — it's called server-side, inside the detail page, with a href built from that page's own route/id, never from request input; it additionally re-validates via `isValidInternalHref()` before writing.
23. **Can the Exceptions page reveal governance data cross-company?** No — every governance-dashboard function it reuses already applies its own `company_id`/`allowAllCompanies` scoping internally (unchanged).
24. **Can approvals be marked complete or exceptions be closed from these new pages?** No — Tasks/Follow-ups/Exceptions are strictly read-only in this pass; no mutation endpoint was added for them (a deliberate scope reduction, documented in §24).
25. **Does any new route bypass `requireWorkspace()`/authentication?** No — every new page calls `requireWorkspace()` first; every new API route calls `getSessionContext()`/`requireApiPermission()` and checks for a session before doing anything else.
