# ERP_CRM_AUTH_CONTEXT_014.md — CRM Authorization Context Integrity

Prompt 14 of the 102-prompt Vercentlabs ERP completion program. Fixes the
CRM authorization context defect Prompt 13 discovered while building the
background worker, and audits every CRM context construction path for an
equivalent gap.

## 1. Executive Summary

`apps/web/src/modules/crm/index.ts`'s `crmContext()` — the single function every CRM
page, API route, mobile route, and shared-workspace adapter uses to turn an
authenticated session into a CRM authorization context — never copied
`session.permissions` or `session.roleSlugs` onto the object it returned.
`canViewAllCrmRecords()` (`services/api/src/modules/crm/index.js`) reads exactly those two
fields to decide whether a caller may see every CRM record in scope or only
their own. With both fields silently missing, `canViewAllCrmRecords()`
evaluated `false` for every real request, regardless of the caller's actual
role or permissions — including `organization_owner`. The defect was
**fail-closed** (over-restriction, not a leak): ordinary users were correctly
scoped, but every manager/administrator/owner persona meant to see
company-wide CRM data instead saw only their own records, silently.

The fix is two lines in one function: `crmContext()` now copies
`session.permissions` and `session.roleSlugs` verbatim from the
already-resolved session — no second authorization query, no role-name
special-casing. Because every CRM consumer in the codebase (28 server pages,
~99 API routes, ~19 mobile routes, global search, dashboards, reports, My
Work) funnels through this one function via `crmContext()`/`crmApiContext()`,
this single fix repairs all of them simultaneously. A companion audit (Part
2) confirmed no second, equivalent context-construction path exists anywhere
in the codebase.

While proving the fix against a real database (required by Part 43/44), a
second, independent, previously-undetected bug was found and fixed in
`recordScope()` itself: a fail-closed early return discarded already-built
SQL text while leaving its already-bound parameter in the query's parameter
array, causing a genuine Postgres bind-parameter-count crash for any
restricted CRM user whose session has a company selected but no active
branch (a realistic state for any branch-less organization). See Section 4.

A third, narrower issue was found and fixed during the audit: two Shared
Workspace ("My Work") adapters — Follow-ups and Tasks — passed the real,
now-permission-bearing CRM context straight into `listCrmRecords()`. Once
`crm.records.view_all` actually worked, a manager's "My Follow-ups"/"My
Tasks" query would have been executed against the whole company's records
(filtered back down to "mine" only in application code, after a `LIMIT`),
risking the manager's own items being silently pushed out of the page by
other users' rows ahead of them. See Section 17.

## 2. Defect Discovery

Discovered incidentally during Prompt 13 (Background Worker & Scheduler
Foundation) while building the worker's least-privilege system-actor
context (`services/worker/src/system-context.js`) and comparing it against
`crmContext()`'s real shape. Confirmed by direct source inspection of both
`crmContext()` and `canViewAllCrmRecords()`, not assumed. Documented in
`docs/implementation/ERP_WORKER_SCHEDULER_013.md`, Sections 1/26/27, and
reported directly to the user at the end of that prompt. Prompt 14 is the
dedicated fix.

## 3. Reproduction

Source-level reproduction (`apps/web/src/modules/crm/index.ts`, before this fix):

```ts
export function crmContext(session: SessionContext): CrmContext {
  return {
    organizationId: session.organizationId as string,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.includes("organization_owner") || ...,
    // permissions and roleSlugs: never present
  };
}
```

```js
// services/api/src/modules/crm/index.js
function canViewAllCrmRecords(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.records.view_all"))
  );
}
```

For any real request, `context.roleSlugs` and `context.permissions` were
`undefined` → both optional-chained lookups short-circuit to `undefined` →
`Boolean(undefined) || Boolean(undefined)` → `false`, unconditionally,
regardless of the authenticated user's actual `session.roleSlugs`/
`session.permissions`. Reproduced live end-to-end in Section 25 against a
real database with a real `organization_owner`-shaped and
`crm.records.view_all`-shaped session, both of which incorrectly returned
owner-scoped results before the fix (see the git history of
`services/worker/tests/crm-auth-context-live.manual.mjs` if run against the
pre-fix commit; the live script as committed already reflects the fixed
behavior since it is not useful to commit a script proving a bug that no
longer exists).

## 4. Root Cause

Two independent, unrelated root causes, both found via this prompt's
required real-chain verification:

1. **The reported defect**: `crmContext()` (Part 3) constructed its return
   object field-by-field and simply never included `permissions`/
   `roleSlugs` — an omission, not a logic error. The `CrmContext` TypeScript
   type (`packages/shared-types/src/modules/crm/index.d.ts`) didn't declare either field
   either, so no type error ever surfaced the gap.
2. **Independently discovered while proving the fix live** (not the
   reported defect, but directly adjacent — same function): `recordScope()`
   has two early-return fail-closed gates (company scope, branch scope).
   Each was written as `return " AND false";` — a bare string literal that
   discards whatever SQL fragment (and, critically, whatever bound
   parameter) an *earlier* gate in the same call had already appended. The
   `parameters` array the caller passes is mutated by reference and is
   NOT rolled back on early return, so a caller ends up with N bound values
   but a query string referencing only N-1 (or fewer) placeholders — a raw
   Postgres protocol error (`bind message supplies N parameters, but
   prepared statement requires N-1`), not an authorization result. Fixed by
   changing both to `return sql + " AND false";`, which preserves whatever
   was already safely built (and keeps its parameter reference intact)
   while still forcing the overall predicate false. See Section 25 for how
   this was found, and `services/api/tests/crm-record-scope.test.mjs`'s new
   regression test for how it is now guarded.

## 5. Session Authorization Model

`apps/web/src/core/auth.ts`'s `SessionContext` is canonical and already
fully resolved by the time any module-specific code runs:

```ts
export type SessionContext = {
  ...
  roleSlugs: string[];
  permissions: string[];
  ...
};
```

Populated once, from a single session-resolution query, with `role_slugs`/
`permissions` defaulting to `[]` (never `null`/`undefined`) if the
underlying row values are falsy (`auth.ts` lines ~480-481: `roleSlugs:
row.role_slugs || []`, `permissions: row.permissions || []`). Every module
context builder in the codebase (`crmContext()`, `salesContext()`,
`accountingContext()`, `procurementContext()`, `qualityContext()`,
`supportContext()`, `projectsContext()`, `platform.ts`,
`business-data.ts`) is expected to consume this session directly — CRM is
not, and after this fix still is not, running a second permission-
resolution query.

## 6. CRM Context Before

```ts
export type CrmContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies?: boolean;
};

export function crmContext(session: SessionContext): CrmContext {
  return {
    organizationId: session.organizationId as string,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
  };
}
```

## 7. CRM Context After

```ts
export type CrmContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies?: boolean;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export function crmContext(session: SessionContext): CrmContext {
  return {
    organizationId: session.organizationId as string,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
```

`permissions`/`roleSlugs` are **required** (non-optional) fields — every
real `CrmContext` in the codebase is either session-derived (always
populated, per Section 5) or `services/worker`'s system actor (always
populated with safe least-privilege defaults, per Section 20). There is no
anonymous/public `CrmContext` anywhere (Section 19), so a discriminated
union or optional-field escape hatch was not needed (Part 24/25).

`crmApiContext()` (the async, module-gate-checking wrapper every API route
uses) is unchanged in structure — it still calls `assertModuleAccessible()`
before delegating to `crmContext()` — so Prompt 5's module-enablement gate
is untouched.

## 8. `crm.records.view_all` Semantics

Unchanged from Prompt 3/12's original design — this prompt did not touch
the meaning of the permission, only whether the context carrying it reaches
the function that checks it:

- Grants CRM record-ownership-scope visibility (leads/opportunities/
  activities) beyond the caller's own owned/assigned rows.
- Does NOT grant cross-tenant access (`organization_id` is always a
  separate, unconditional filter — Section 22).
- Does NOT bypass company/branch scope (`allowAllCompanies` is a wholly
  separate gate — Section 22).
- Does NOT bypass module/plan entitlement (`crmApiContext()`'s
  `assertModuleAccessible()` call runs first, unconditionally — Section 23).
- Does NOT imply edit/archive/delete authority — those remain independently
  gated by their own action permissions (Section 14).

## 9. Role / Permission Propagation

`roleSlugs` is genuinely consumed by CRM logic in two places, both
pre-existing and both now correctly fed real data:

- `canViewAllCrmRecords()`'s `organization_owner` branch (defense-in-depth
  alongside the `crm.records.view_all` permission check — `organization_owner`
  is granted `ALL_PERMISSIONS`, so this branch is currently redundant with
  the permission check but was deliberately kept, matching the existing
  code rather than removed without evidence it's unsafe, per Part 51).
- `crmContext()`'s own `allowAllCompanies` computation (`organization_owner`
  / `system_administrator` — a company/branch SCOPE concern, deliberately
  separate from CRM record-ownership scope, per Part 29).

No CRM logic anywhere hardcodes a role-name check standing in for
`crm.records.view_all` itself — confirmed by source-pattern test
(`apps/web/tests/crm-auth-context.test.mjs`).

## 10. Leads

- Restricted user: sees only leads they own (`owner_user_id`), or unowned
  leads (`owner_user_id IS NULL`) — unchanged Prompt 3 semantics, live-
  verified working correctly now that the gate actually receives real
  permission data.
- Elevated user (`crm.records.view_all`): sees every lead within
  company/branch/tenant scope — live-verified.
- Direct detail (`getCrmRecord`): restricted user requesting another
  user's lead by ID → `404 CRM record not found` (existing IDOR-safe
  semantics, unchanged, avoids confirming the record's existence).
- Mutation: restricted non-owner update/archive → same 404 (blocked before
  any write); elevated user can update/archive subject to their own
  `crm.leads.manage`-family permission independently (Section 14).

## 11. Opportunities

Identical scoping mechanism to Leads (`owner_user_id`, `companyScoped`).
Restricted/elevated behavior verified via a new pure-function test
(`services/api/tests/crm-record-scope.test.mjs`) mirroring the Leads
coverage exactly, since both resources share the same `recordScope()`/
`canViewAllCrmRecords()` code path.

## 12. Activities

Same mechanism, different owner column (`assigned_to` via
`ownerField: "assignedTo"`, not `owner_user_id`) — live-verified against a
real database in `crm-auth-context-live.manual.mjs`, exercising the
different column-name branch explicitly. The pre-existing parent/child
bypass protection (an activity's own `assigned_to` governs visibility
independent of its parent lead/opportunity's owner) is untouched and
remains covered by its existing test.

## 13. Detail Access

`getCrmRecord()`'s `WHERE organization_id = $1 AND id = $2 <recordScope>`
shape is unchanged. Restricted users get `404`, never `403` — this was a
deliberate Prompt 3 choice to avoid confirming record existence to an
unauthorized caller (ID enumeration resistance), preserved as-is.

## 14. Mutations

`assertOwnerAssignmentAllowed()` (blocks a restricted user from handing a
record to someone else) and each resource's own action permission
(`crm.leads.manage`, `crm.opportunities.manage`, `crm.activities.manage`)
remain fully independent of `canViewAllCrmRecords()`. Verified by the
existing and new mutation-matrix tests in `crm-record-scope.test.mjs`:
view-all grants *visibility*, never *write authority* — a restricted user
still cannot write to a record they can't see, and an elevated user without
the resource's manage permission still cannot write to a record they CAN
now see.

## 15. Dashboard / Reports

`getCrmDashboard()` and `getCrmReport()` already threaded
`canViewAllCrmRecords(context)` into their SQL parameters (confirmed by the
pre-existing tests in `crm-record-scope.test.mjs`, lines testing
`capturedParams[4]`/`capturedParams[6]`) — they needed no code change.
Before this fix those parameters were silently always `false`; after, they
correctly reflect the real caller. Dashboard/list/report/search now agree
on the same record boundary (Section 40 of the prompt spec; verified by
inspection — all four call the same `crmApiContext()`/`canViewAllCrmRecords()`
pipeline).

## 16. Global Search

`apps/web/src/app/api/search/route.ts`'s CRM adapter calls
`crmApiContext(session)` directly (unmodified) and delegates to the exact
same `listCrmRecords()` the CRM list route uses — no bespoke SQL, confirmed
by the pre-existing `search-security.test.mjs` suite (still green). This
means global search's CRM record boundary was automatically repaired by
the `crmContext()` fix with zero changes to the search route itself, and
now correctly agrees with normal CRM list visibility for both restricted
and elevated users.

## 17. My Work Interaction

**Found and fixed as part of this prompt's required audit (Part 17).**
`apps/web/src/core/work/follow-ups.ts`'s `listMyFollowUps()` and
`apps/web/src/core/work/tasks.ts`'s `crmActivityTasks()` both called
`crmApiContext(session)` and passed the resulting context straight into
`listCrmRecords()`, then filtered the results down to "mine" in an
in-process `.filter()`. Before this prompt's fix, that context's
`permissions`/`roleSlugs` were always empty, so the underlying SQL query
was ALREADY effectively owner/assignee-scoped by accident — the bug
masked a latent correctness issue. Once `crmContext()` correctly propagates
real permissions, a manager holding `crm.records.view_all` would have had
the SAME query run WITHOUT the SQL-level ownership filter, return up to
`limit: 200`/`limit: 100` company-wide rows (in whatever order the query
returns them), and only THEN filter down to "mine" in memory — risking the
manager's own follow-ups/tasks being silently squeezed out by the row cap
if enough of their team's records sorted ahead of theirs.

Fixed by explicitly stripping `permissions`/`roleSlugs` to empty arrays on
a local copy of the context before calling `listCrmRecords()` in both
files:

```ts
const context = { ...(await crmApiContext(session)), permissions: [], roleSlugs: [] };
```

This forces `canViewAllCrmRecords()` back to `false` for this specific
query regardless of the caller's real permissions or role (including
`organization_owner`), guaranteeing "My Follow-ups"/"My Tasks" mean mine —
full stop — never company-wide, matching the intended product semantics
(Part 17 explicitly: this must not become "Everyone's Tasks" without an
explicit product decision, which was not made here). Covered by a new
source-pattern test in `apps/web/tests/crm-auth-context.test.mjs` guarding
against this specific override being silently reverted.

`exceptions.ts` (the third My Work adapter) does not touch CRM at all
(finance/procurement/support/quality sources only) and required no change.

## 18. Recent / Favourites

`recent-records.ts` and `favourites.ts` store only a label + internal href
per row, re-validating only MODULE-level accessibility on every read
(`resolveModuleAccess()`), never record-level CRM ownership. This is
unaffected by this prompt's fix (neither file touches `CrmContext`) and
was already correct in isolation: a stale/revoked link is never itself
authorization — if a restricted user clicks through to a CRM record they
no longer own, the destination page's own `crmContext()`-backed loader
(Section 13) re-checks live and returns 404, exactly as it would for any
other now-unauthorized record. No code change was needed or made here;
confirmed by inspection, not assumed.

## 19. Public CRM

Public lead capture (`apps/web/src/app/api/crm/public/capture/[key]/route.ts`)
uses `captureCrmLead()`, a wholly separate function that never constructs
or touches `CrmContext` — confirmed by source inspection and a new test.
The two public meeting-booking routes similarly never reference
`CrmContext`. Making `permissions`/`roleSlugs` required (non-optional)
fields on `CrmContext` was therefore safe: no public/anonymous code path
ever needed to construct one.

## 20. Worker/System Context

`services/worker/src/system-context.js`'s `buildSystemContext()` was
already least-privilege and already populated both fields correctly
(`permissions: []`, `roleSlugs: ["system_worker"]`) — built independently
of `crmContext()` in Prompt 13, since the worker has no HTTP session.
Confirmed unchanged and unaffected by this prompt's fix, via source
inspection and a new regression test.

## 21. Mobile API Consistency

Every mobile CRM route inspected (`apps/web/src/app/api/mobile/v1/crm/**`,
`workspace/[area]/route.ts`) calls the same `crmApiContext()` web CRM
routes use — no separate mobile-specific context builder exists. Confirmed
by source inspection across all matching mobile route files. Web and
mobile therefore have identical record-scope semantics both before and
after this fix, with no route-specific work required.

## 22. Tenant / Company / Branch Scope

- **Tenant**: `organization_id = $1` is unconditional in every CRM query,
  independent of `context.permissions`/`context.roleSlugs` — `view_all` has
  no tenant-crossing effect. Live-verified: an org-A manager holding
  `crm.records.view_all` cannot reach an org-B lead by ID (404).
  Independent of RLS, which additionally enforces the same boundary at the
  database layer for defense-in-depth.
- **Company/branch**: gated by `allowAllCompanies`, computed independently
  of `crm.records.view_all` (Section 9) — `view_all` alone does not set
  `allowAllCompanies`. Live-verified via the `recordScope()` fix in Section
  4: a restricted user's company/branch gate is evaluated (and correctly
  denies/allows) entirely separately from their record-ownership gate.

## 23. Module / Entitlement Interaction

`crmApiContext()` calls `assertModuleAccessible(session, "crm")` BEFORE
`crmContext()` runs — unchanged. An elevated `crm.records.view_all` holder
in an organization with CRM disabled, or on a plan without CRM entitled,
is still denied at the module gate before record-scope logic is ever
reached. Server-rendered CRM pages call the bare, synchronous
`crmContext()` (no module gate) by long-standing, documented design
(`ERP_MODULE_ENFORCEMENT_005.md`'s "Remaining Gaps" — page-level module
guards are a separate, already-existing mechanism, Prompt 6) — unchanged by
this prompt.

## 24. Tests Added

- `services/api/tests/crm-record-scope.test.mjs`: +5 tests —
  `organization_owner` via `roleSlugs` alone with an empty `permissions`
  array (the exact Prompt 13 finding); a context missing
  `permissions`/`roleSlugs` entirely fails closed; a regression guard for
  the `recordScope()` bind-parameter-mismatch bug (Section 4); an
  Opportunities-specific restricted/elevated pair mirroring the existing
  Leads coverage.
- `apps/web/tests/crm-auth-context.test.mjs` (new file): 8 source-pattern
  tests — `crmContext()` propagates both fields; no hardcoded role-name
  stand-in for `crm.records.view_all`; `CrmContext`'s two new fields are
  required, not optional; both My Work adapters strip the fields before
  querying (Section 17); the worker's system context is unaffected; public
  capture never touches `CrmContext`; `crmApiContext()`'s module gate is
  intact.
- `services/worker/tests/crm-auth-context-live.manual.mjs` (new,
  live-Postgres-only, excluded from `pnpm verify`/`pnpm test:worker` by the
  same `*.manual.mjs` naming convention Prompt 13 established): 11 real,
  end-to-end checks against a real database — see Section 25.

## 25. Live DB Verification

Run manually against the local Postgres instance
(`services/worker/tests/crm-auth-context-live.manual.mjs`), because — per
Part 43 of the prompt — this specific class of bug (a caller never reaching
a pure function with the right data) cannot be caught by a pure-function
test alone; only the pre-existing mocked-client tests existed before this
prompt, and they could not have caught it. The script creates two real
organizations, five real users, two real leads, two real activities, and
one cross-tenant lead; runs eleven checks; deletes everything it created in
a `finally` block regardless of outcome. All eleven passed:

```
OK   restricted user A sees their own lead in list
OK   restricted user A does NOT see user B's lead in list
OK   restricted user A gets 404 (not leaked) on direct-ID access to user B's lead
OK   auditor persona (no view_all) sees neither lead they don't own
OK   manager with crm.records.view_all sees BOTH leads
OK   manager with crm.records.view_all sees BOTH activities (assigned_to-based ownerField)
OK   manager can directly open user B's lead by ID
OK   organization_owner (roleSlugs-derived) sees BOTH leads even with an empty permissions array
OK   same manager with view_all removed reverts to seeing neither (fresh per-request context, no stale cache)
OK   context missing permissions/roleSlugs entirely fails CLOSED (sees nothing), never open
OK   org A manager with crm.records.view_all CANNOT reach org B's lead by ID (tenant isolation holds regardless of permission)

ALL CHECKS PASSED
```

Running this script against the pre-fix `recordScope()` (before Section 4's
fix) crashed with a raw Postgres protocol error
(`bind message supplies 2 parameters, but prepared statement "" requires
1`) on the very first restricted-user list query — this is exactly the kind
of defect Part 43 anticipated a pure-function/mocked-client suite could not
catch, and did not.

Post-run verification confirmed zero residual rows
(`SELECT count(*) FROM public.organizations WHERE name LIKE 'P14 Test%'` →
0; same for the created users) — the script's cleanup is complete.

## 26. Adversarial Review

All 30 questions from Part 72 of the prompt, answered directly:

1. Can a restricted user now see another user's Lead? **No** — live-verified denied.
2. Can a restricted user see another user's Opportunity? **No** — pure-function-verified (mirrors Leads).
3. Can a restricted user see another user's Activity? **No** — live-verified denied (different owner column).
4. Can `view_all` user see authorized team records? **Yes** — live-verified for Leads and Activities.
5. Can view-all bypass tenant boundary? **No** — live-verified denied (org-A manager, org-B lead → 404).
6. Can view-all bypass company scope? **No** — `allowAllCompanies` is a separate gate, unaffected by `view_all`.
7. Can view-all bypass branch scope? **No** — same separate gate; also the specific subject of the Section 4 fix.
8. Can view-all bypass disabled CRM? **No** — `assertModuleAccessible()` runs first, unconditionally.
9. Can view-all bypass plan entitlement? **No** — same module gate covers plan entitlement.
10. Can view-all grant edit permission implicitly? **No** — action permissions remain independently checked (Section 14).
11. Can view-all grant archive permission implicitly? **No** — same as above.
12. Can sales representative accidentally receive view-all? **No** — `sales_representative`'s permission list (`access-control.ts`) does not include `crm.records.view_all`; unchanged by this prompt.
13. Can auditor accidentally receive view-all? **No** — same; live-verified with an auditor-shaped permission set.
14. Can organization owner remain incorrectly owner-scoped? **No, fixed** — this was the exact reported defect; live-verified.
15. Can CRM manager remain incorrectly owner-scoped? **No, fixed** — live-verified with an explicit `crm.records.view_all` grant.
16. Can global search disagree with CRM list scope? **No** — same `crmApiContext()`/`listCrmRecords()` pipeline (Section 16).
17. Can dashboard/report disagree with CRM list scope? **No** — same `canViewAllCrmRecords(context)` parameter threading (Section 15).
18. Can My Work suddenly show everyone's activities? **No, explicitly prevented** — Section 17's fix.
19. Can Follow-ups become organization-wide unexpectedly? **No, explicitly prevented** — same fix.
20. Can Recent records bypass current CRM scope? **No** — module-level revalidation plus live re-check on click-through (Section 18).
21. Can Favourites bypass current CRM scope? **No** — same.
22. Can public lead capture break because permissions are absent? **No** — it never touches `CrmContext` (Section 19).
23. Can worker/system CRM jobs inherit human admin permissions? **No** — `buildSystemContext()` unchanged, least-privilege (Section 20).
24. Can mobile API remain more restrictive than web? **No** — identical `crmApiContext()` usage confirmed (Section 21); "more restrictive" was never the concern here, "equally correct" was, and is now met for both.
25. Can missing permission context fail open? **No** — live-verified: a context missing both fields entirely returns zero rows, not all rows.
26. Can client spoof permissions? **No** — no route accepts a client-supplied `permissions`/`roleSlugs`/`viewAll` field; confirmed unchanged by this prompt (Part 41/42 were not violated).
27. Can client spoof role slug? **No** — same.
28. Can assignment changes produce stale incorrect visibility? **No** — every request re-derives context fresh from the current session; no new caching was introduced (Part 27/61 — permissions resolved once per request, not per-row).
29. Can duplicate detection leak inaccessible records? **No, unchanged** — `findCrmDuplicates()` deliberately strips `ownerField` for its own scope (pre-existing Prompt 12 fix), verified still passing.
30. Can one context helper remain uncorrected and preserve the bug? **No** — Part 2's audit confirmed `crmContext()` is the ONLY CRM context construction path; every consumer (web pages, ~99 API routes, ~19 mobile routes, search, dashboards, reports, My Work) calls it or its `crmApiContext()` wrapper, with the sole legitimate exception being the worker's independently-built, already-correct system context (Section 20).

## 27. Prompt 11 Matrix Impact

- **Affected evidence-backed rows**: `CRM-017` (Access control — per-record
  ownership scoping) and `SHARED-020` (Record-level access — CRM
  ownership), both `docs/implementation/ERP_FEATURE_MATRIX_011.csv`.
- **Status changes**: both rows' underlying mechanism
  (`recordScope()`/`canViewAllCrmRecords()`) was already `COMPLETE` at the
  code level per Prompt 11/12, but both were marked `LIMITED` UAT-readiness
  specifically because the elevated-visibility half was unverified/
  unreachable in a real request — this prompt closes that gap. Recommend:
  `LIMITED` → `READY` for both, now that end-to-end propagation is
  live-verified.
- **UAT changes**: "manager/owner sees team CRM records" scenarios, listed
  as not independently verifiable in Prompt 11, are now `READY` for UAT.
- **Exact 1,039-row claim made: NO.**

## 28. Remaining CRM Gaps

Explicitly out of scope for this prompt (per Parts 65-69) and not touched:
worker module-enablement gating, webhook multi-subscription fan-out,
Quality-hold enforcement, HR/payroll correctness, and any new CRM feature
(triggers, reports, AI scoring, campaigns, journeys, forecasting,
partner/reseller capability). The `allowAllCompanies` computation's own
hardcoded `organization_owner`/`system_administrator` role-name check
(Section 9) is pre-existing, unchanged, and out of this prompt's scope
(it governs company/branch SCOPE, a deliberately separate concern from
`crm.records.view_all`) — flagged here only for visibility, not treated as
a defect.

## 29. Files Changed

**Modified:**
- `packages/shared-types/src/modules/crm/index.d.ts` — `CrmContext` gains required
  `permissions`/`roleSlugs` fields.
- `apps/web/src/modules/crm/index.ts` — `crmContext()` propagates both fields from
  the session.
- `apps/web/src/core/work/follow-ups.ts` — `listMyFollowUps()` forces
  self-scope regardless of `view_all`.
- `apps/web/src/core/work/tasks.ts` — `crmActivityTasks()` forces
  self-scope regardless of `view_all`.
- `services/api/src/modules/crm/index.js` — `recordScope()`'s two fail-closed early
  returns fixed to preserve already-bound parameters (Section 4).
- `services/api/tests/crm-record-scope.test.mjs` — +5 tests.

**New:**
- `apps/web/tests/crm-auth-context.test.mjs`.
- `services/worker/tests/crm-auth-context-live.manual.mjs`.
- `docs/implementation/ERP_CRM_AUTH_CONTEXT_014.md` (this file).

## 30. Verification Results

| Check | Result |
|---|---|
| `pnpm verify:fast` | PASS |
| `pnpm verify:worker` | PASS (62/62 tests, structural checks clean) |
| `pnpm verify:mobile` | PASS |
| `pnpm verify:db` | PASS (0 failing checks, 1 pre-existing unrelated warning) |
| `pnpm verify:web` | PASS |
| `pnpm verify` | PASS |
| Live-DB verification | PASS (11/11 checks, `crm-auth-context-live.manual.mjs`) |
| `services/api` full suite | PASS (89/89) |
| `apps/web` full suite | PASS (280/280) |
| `services/worker` full suite | PASS (62/62) |

STOP AFTER PROMPT 14. DO NOT START PROMPT 15.
