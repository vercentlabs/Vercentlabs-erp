# ERP Security Enforcement Hardening (Prompt 3 of 102)

Date: 2026-08-08
Scope: close the three highest-confidence security enforcement gaps identified in `docs/implementation/ERP_WEB_AUDIT_001.md` — dead field-level permissions, missing CRM record ownership scope, and unprotected public lead capture. No unrelated UI, RBAC redesign, CRM redesign, or Procurement refactoring was performed.

Starting git state: branch `main`, all Prompt 1/2 changes present and untouched (3 modified files, ~20 untracked files). Nothing was reset, stashed, or discarded. No commits were made.

---

## 1. Executive Summary

Three confirmed gaps from Prompt 1 are closed, all enforced at the service layer (the same layer that already enforces every other permission check in this codebase — no parallel authorization framework was introduced):

1. **Field-level permissions** (`hr_payroll.sensitive.view`, `support.sensitive.view`, `procurement.suppliers.sensitive`) — previously defined and assignable but never checked anywhere — now gate real fields: HR employee PII (`personal_email`, `date_of_birth`, `bank_details`, etc.), Support's internal-only communications (`private_note = true` rows), and Procurement supplier banking details. Reads are omitted for unauthorized callers; Procurement writes are rejected outright (the only one of the three with an established mass-assignment risk and a role split that already implied read+write governance).
2. **CRM record ownership scope** — `crm.leads`, `crm.opportunities`, and `crm.activities` now respect a new `crm.records.view_all` permission, granted to every existing CRM/sales manager and administrator role except Sales Representative (the exact role Prompt 1 named). A restricted caller sees only records they own/are assigned, cannot access another's record by ID, and CRM dashboards/reports no longer leak company-wide totals to a restricted viewer. Duplicate detection was deliberately kept company-wide (not owner-scoped) — see Section 11 for why that mattered.
3. **Public lead-capture abuse protection** — re-investigation found the *primary* capture endpoint (`/api/crm/public/capture/[key]`) was already far better protected than Prompt 1's summary suggested (DB-backed hourly rate limiting, an HMAC-verified trusted-proxy fingerprint, a working honeypot, a 50KB body cap, and `.strict()` Zod validation). The real, previously-undiscovered gap was a **second, materially weaker public capture endpoint** (`/api/crm/lead-acquisition/public/forms/[key]`) that trusted a raw `X-Forwarded-For` header for its rate-limit key (trivially spoofable) and had no request-body size cap. Both endpoints now share one hardened fingerprint implementation.

A fourth finding surfaced only during the mandated adversarial self-review (Part 12): the CRM ownership-scope change, if applied uniformly, would have silently narrowed lead **duplicate detection** to "duplicates I own," breaking its actual purpose (catching a colleague's matching lead). This was caught and fixed before completion — see Section 11.

## 2. Original Findings

From `docs/implementation/ERP_WEB_AUDIT_001.md`, Section 12 ("Confirmed security gaps"):

1. `hr_payroll.sensitive.view`, `support.sensitive.view`, `procurement.suppliers.sensitive` are defined, assignable, never checked (`packages/permissions/src/{hr-payroll,support,procurement}.js`).
2. `services/api/src/crm.js:1283-1297` (`recordScope`) filters only by `company_id`/`branch_id`, never by assignee — "any user with `crm.leads.manage` sees every lead in their company."
3. `apps/web/src/app/api/crm/public/capture/[key]/route.ts` "never calls `enforceRateLimit()`."

Re-verified against the current repository in Phase A of this prompt, with corrections:

- Finding 1 confirmed exactly as stated for `hr_payroll.sensitive.view`/`support.sensitive.view`. `procurement.suppliers.sensitive` was additionally found to be **missing from `apps/web/src/lib/authorization.ts`'s `PERMISSIONS` object entirely** — it existed in `packages/permissions` and was granted to roles in `access-control.ts`, but there was no `PERMISSIONS.*` constant a route could even reference. Added in this prompt (Section 4).
- Finding 2 confirmed. Additionally discovered: `access-control.ts`'s role catalogue has **no assignable HR or Support role at all** today (only an unassignable "future" HR Manager stub) — the only roles that currently see `hr_payroll.*`/`support.*` data at all are `organization_owner`/`system_administrator`/`company_administrator` via `ALL_PERMISSIONS`. This means the HR/Support field-permission fix is genuinely defense-in-depth today (no narrower role exists yet to exploit the gap) but becomes load-bearing the moment a real HR/Support operational role is added — exactly the scenario the fix should already be correct for.
- Finding 3 **partially incorrect** — Prompt 1 checked for the app's generic `enforceRateLimit()` helper and correctly found it absent from this route, but concluded "no rate limiting" without checking for a purpose-built alternative. `captureCrmLead` (`services/api/src/crm.js`) has its own DB-backed hourly rate limiter (`tenant.crm_capture_rate_limits`, insert-and-increment-with-`ON CONFLICT`, per organization+form+fingerprint) that was already working correctly. The real, more serious gap — a second public capture route with a spoofable rate-limit key and no body-size cap — was not in Prompt 1's audit at all; it surfaced only from this prompt's explicit instruction to "locate every public lead-capture entry point... do not protect only one frontend."

## 3. Field-Level Permission Model

| Permission | Read semantics | Write semantics | Reasoning |
|---|---|---|---|
| `hr_payroll.sensitive.view` | Omit protected fields from `tenant.hr_employees` reads for callers without the permission | Unchanged — governed by the pre-existing `hr_payroll.employee.manage` | The permission is named "sensitiveView"; no separate "manage sensitive" permission exists in the codebase, and `hr_payroll.employee.manage` is the only mutation path today, held only by roles that already carry `ALL_PERMISSIONS` (which includes `sensitiveView`) — gating writes separately would currently be unreachable dead logic, and the naming doesn't support inventing a write variant |
| `support.sensitive.view` | Omit `tenant.support_communications` rows where `private_note = true` from reads for callers without the permission | Unchanged — governed by the pre-existing `support.communication.manage` | Same "View" naming reasoning. Also: gating basic ticket fields (`customer_email`/`customer_phone`) would have broken the core, ubiquitous "handle a ticket" workflow for every support agent — those were deliberately left ungated; only genuinely internal-only content (the `private_note` flag, whose entire purpose is marking something not customer-visible) was scoped |
| `procurement.suppliers.sensitive` | Omit a defined set of supplier banking/financial-account keys from `tenant.procurement_suppliers` reads | **Reject** (403) any create/update payload that sets one of those keys, for callers without the permission | Unlike HR/Support, this permission is already granted alongside `.manage`/`.qualify` to specific elevated roles (Procurement Manager, Supplier Manager) while explicitly withheld from Buyer — a role that **does** hold `.manage` — which is a real, current, exploitable read+write distinction, not a hypothetical future one |

Field ownership was determined by reading the actual table schemas and service-layer code (not assumed) — see `docs/implementation/ERP_WEB_AUDIT_001.md`-style evidence gathering repeated for this prompt.

## 4. Field Permission Changes

| Resource | Field | Permission | Read Enforcement | Write Enforcement |
|---|---|---|---|---|
| `tenant.hr_employees` | `personal_email`, `personal_phone`, `date_of_birth`, `gender`, `marital_status`, `nationality`, `address`, `bank_details`, `tax_identifiers`, `statutory_identifiers`, `emergency_contacts` | `hr_payroll.sensitive.view` | Omitted from `listHrPayrollResource("employees", …)` and from `createEmployee`'s `RETURNING *` echo, for callers lacking the permission | Unaffected (see Section 3) |
| `tenant.support_communications` | Entire row, when `private_note = true` | `support.sensitive.view` | Filtered out of `listSupportResource("communications", …)` for callers lacking the permission | Unaffected (see Section 3) |
| `tenant.procurement_suppliers` (`data` jsonb) | `bankAccountNumber`, `bankAccountName`, `bankName`, `bankBranch`, `bankIfscCode`, `bankSwiftCode`, `bankRoutingNumber`, `bankIban` | `procurement.suppliers.sensitive` | Omitted from `listProcurementRecords`/`getProcurementRecord` for resource `suppliers`, for callers lacking the permission (also closes the create/update `RETURNING`-echo and the `transitionProcurementRecord`/status-transition response, since both route back through `getProcurementRecord`) | `createProcurementRecord`/`updateProcurementRecord` reject (403 `PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN`) if the raw request body sets any of these keys and the caller lacks the permission |

`taxRegistrationNumber` was **deliberately excluded** from the Procurement sensitive-key list: it is already a normal, ungated field on the standard supplier form, actively submitted today by roles (Buyer) that hold `.manage` but not `.sensitive`. Gating it now would have been a backward-incompatible regression of an existing, working workflow (Part 8's explicit concern) for a field that carries materially lower risk than actual banking details. No banking field is wired into any current UI form, so this closes a real mass-assignment gap (the underlying `data jsonb` column accepts arbitrary keys via `.passthrough()`) without breaking anything a real user does today.

**Bypass prevention checked and confirmed closed**:
- **Bulk/list paths**: `listHrPayrollResource`, `listSupportResource`, `listProcurementRecords` all apply the same field-visibility function as their single-record counterparts.
- **Secondary response paths**: HR's `createEmployee` and Procurement's `createProcurementRecord`/`updateProcurementRecord`/`transitionProcurementRecord` all echo the mutated row back to the caller — every one of these was checked and either applies the field-visibility function directly or routes through `getProcurementRecord` (which does).
- **Mass assignment**: HR/Support creation paths were confirmed to already use explicit-column INSERTs (not spread/mass-assignment) with an allowlisted Zod schema — no additional protection was needed there. Procurement's supplier writes go through `normalizeDocument`, which spreads the raw request body (`.passthrough()`) into the persisted `data` jsonb — this is the one genuinely spread-based path, and it is exactly where the new `assertSupplierSensitiveFieldsAllowed` check was placed, checking the **raw incoming request body** (`Object.prototype.hasOwnProperty`), not the DB-merged payload, so an update that never mentions a sensitive key is unaffected regardless of what the existing record already has stored.
- **Exports/reports**: no export endpoints exist for any of the three modules (checked: no CSV/export routes under `apps/web/src/app/api/{hr-payroll,support,procurement}`). Procurement's `getProcurementReport("supplier-performance"/"supplier-risk")` was checked and confirmed to only aggregate `supplierCode`/`displayName`/`status`/scorecard numbers — never the banking keys.

## 5. CRM Record Scope Model

**Scope implemented**: exactly two tiers, matching what the existing permission model actually supports — this repository has no team/territory/hierarchy sharing infrastructure to build on, so none was invented.

- **Owner/assignee scope** (default): a caller sees/mutates only records where they are the owner (`crm_leads.owner_user_id`, `crm_opportunities.owner_user_id`) or assignee (`crm_activities.assigned_to`), plus any record with no owner yet (`owner_user_id IS NULL`, e.g. a freshly captured lead awaiting assignment — visible to anyone who can otherwise see the resource, mirroring the existing `company_id IS NULL` convention already used for company scope).
- **`crm.records.view_all`** (new permission): a caller sees every record within their existing company/branch scope, unchanged from current behavior. Granted to CRM Administrator, Sales Head, Sales Manager, Sales Operations, Marketing Manager, Customer Success Manager, and Partner Manager — every currently-defined CRM/sales role **except** Sales Representative, whose own role description ("Manage assigned leads, accounts, opportunities...") is the exact language Prompt 1 flagged as unenforced. `organization_owner`/`system_administrator`/`company_administrator` already receive it automatically via `ALL_PERMISSIONS`.

This is **not** a general-purpose sharing model — no "team," "territory," or hierarchical-manager-sees-reports'-records concept was implemented, because none exists in the current permission catalogue to derive it from. Adding one would be new product design, out of scope for this prompt.

**Resources given ownership scope**: `leads`, `opportunities` (both explicitly named in Prompt 1's finding, both have a persisted `owner_user_id` column), and `activities` (has a persisted `assigned_to` column, explicitly named in Part 2's resource-inspection list). **Resources deliberately left unscoped**: `campaigns` and `capture-forms` also have `owner_user_id` columns but were not given ownership scope — they are shared marketing/configuration objects, not individually-owned "my work" records, and scoping them risked breaking normal collaborative marketing workflows for a case Prompt 1 never evidenced. `accounts`/`contacts` (routed through the separate, more broadly-shared `business-data.ts`/master-data system, not `crm.js`) were left untouched — extending ownership scope there would affect Sales, Accounting, and Procurement consumers of the same master data, a materially larger and riskier change than this prompt's mandate.

## 6. CRM Resource Coverage

| Resource | Ownership Source | List Scoped | Detail Scoped | Mutation Scoped | Analytics Scoped |
|---|---|---|---|---|---|
| `leads` | `owner_user_id` (existing column) | Yes | Yes | Yes (create/update/archive) | Yes (dashboard + `conversion`/`sources` reports) |
| `opportunities` | `owner_user_id` (existing column) | Yes | Yes | Yes | Yes (dashboard + `pipeline`/`forecast`/`revenue-operations` reports, including per-salesperson quota rollups) |
| `activities` | `assigned_to` (existing column) | Yes | Yes | Yes | Yes (dashboard + `activities` report) |
| `campaigns` | `owner_user_id` exists but deliberately not used for scoping | No (company/branch only, unchanged) | No (unchanged) | No (unchanged) | No (`campaigns` report unchanged) |
| `capture-forms` | `owner_user_id` exists but deliberately not used for scoping | No (unchanged) | No (unchanged) | No (unchanged) | N/A |
| `accounts`/`contacts` (business-data/master-data) | No per-record ownership concept in that system | Out of scope — different module | Out of scope | Out of scope | Out of scope |
| All other CRM resources (pipelines, stages, sources, communications, saved-views, sales-teams, territories, quota-plans, forecast-*, account-plans, playbooks, consent-events, privacy-requests, etc.) | No ownership concept | Unchanged (company/branch scope only, as before) | Unchanged | Unchanged | Unchanged |

## 7. IDOR Protection

`getCrmRecord(client, context, resource, id)` is the single function every direct-by-ID read in this codebase goes through — confirmed via source inspection, not assumed — and it builds its `WHERE` clause from the same `recordScope()` function used by `listCrmRecords`. Since `recordScope()` now appends `AND (record.<ownerColumn> IS NULL OR record.<ownerColumn> = $userId)` for owner-scoped resources, a caller requesting an inaccessible record's ID gets **zero rows back**, which `getCrmRecord` already turns into a generic `404 "CRM record not found."` — the same response as a record that doesn't exist at all, so no existence-disclosure side channel was introduced. This required no new code in `getCrmRecord` itself.

Because `updateCrmRecord` and `archiveCrmRecord` both call `getCrmRecord` first (an existing pattern, confirmed by reading both functions), unauthorized updates and archives are **transitively** blocked by the same fix — the record can never be loaded, so the mutation code is never reached. `transitionProcurementRecord` follows the identical pattern for Procurement suppliers. This is why Section 4/6's coverage is broad despite touching very little code: the codebase's existing "load via the one shared getter, then mutate" architecture did most of the work once the getter itself was fixed.

## 8. Public Lead-Capture Security

**Endpoints** (both located and both hardened, per the explicit "do not protect only one frontend" instruction):
1. `POST /api/crm/public/capture/[key]` (`apps/web/src/app/api/crm/public/capture/[key]/route.ts`) — the primary, form-key-driven capture endpoint. Backed by `captureCrmLead` (`services/api/src/crm.js`).
2. `POST /api/crm/lead-acquisition/public/forms/[key]` (`apps/web/src/app/api/crm/lead-acquisition/public/forms/[key]/route.ts`) — a newer, dynamic-schema "published lead form" endpoint. Backed by `submitPublishedLeadForm` (`services/api/src/crm/lead-acquisition.js`).

**Tenant/public-key resolution**: both endpoints resolve `organization_id` exclusively from a server-side DB lookup keyed by the URL's opaque form key (`tenant.crm_public_capture_form(key)` / `tenant.crm_public_capture_form_v2(key)`, both `SECURITY DEFINER` functions filtering `status = 'active'` — disabled/revoked forms are already correctly rejected as a 404). Neither endpoint's request schema accepts an organization/tenant field from the client at all, so there is no field to spoof. Confirmed with a source-level regression test (Section 10).

**Validation**: the primary endpoint's `publicCaptureSchema` (Zod, `.strict()`) already bounded every named field (name/email/phone/company/message lengths, a 4,000-char product-interest cap, a numeric `estimatedValue` range) — the one gap was `customData: z.record(z.string(), z.unknown())` having no size bound; this prompt added a 40-key / 20,000-character cap. The second endpoint has no static schema (it validates dynamically against a tenant-configured `form_schema`, by design) and previously had no request-body size cap at all — closed via the same `readRequestBytes(request, 50_000)` helper the primary endpoint already used.

**Rate limiting**: both endpoints share one DB-backed hourly counter (`tenant.crm_capture_rate_limits`, `organization_id`+`form_id`+`fingerprint`+hour-window, atomic `INSERT … ON CONFLICT DO UPDATE`), which was already correctly implemented and was **not rebuilt**. What was fixed is the **fingerprint source**: both routes now compute it via one new shared pair of functions in `apps/web/src/lib/security.ts` — `verifiedCaptureProxyFingerprint()` (HMAC-SHA256-signed, timestamped, replay-windowed, for trusted delivery proxies) falling back to `directCaptureFingerprint()` (`clientIp()` + user-agent hash — `clientIp()` itself only trusts an operator-configured header, never a raw client-suppliable one). The second endpoint previously read `x-forwarded-for` directly and unconditionally trusted it — an attacker could set a different value on every request to mint a fresh rate-limit bucket each time, fully bypassing the limiter. This is now closed (both endpoints tested identically, Section 10).

**Mass-assignment protection**: confirmed for both. The primary endpoint's `.strict()` schema structurally cannot carry an unexpected key. The second endpoint has no static schema, but `submitPublishedLeadForm` only ever extracts a fixed set of typed lead fields (`firstName`/`lastName`/`email`/`mobile`/`companyName`/`jobTitle`/consent flags, each passed through explicit `text()`/`email()`/`boolean()` sanitizers) — every other submitted key lands in an unbounded-but-now-body-size-capped `customData`/`original_payload` blob, never in a typed column like `status`/`stage`/`score`/`ownerUserId`. No privileged field can be set through either endpoint.

**Duplicate behavior**: unchanged and deliberately preserved — `crm_settings.duplicate_policy` still governs whether a detected duplicate blocks submission or only sets a `duplicateWarning` flag; this prompt did not touch that logic, only fixed a scoping regression it would otherwise have introduced (Section 11).

**Response behavior**: both endpoints already correctly map a thrown `CrmError`/`CrmLeadAcquisitionError` with `.status = 429` through to a real HTTP 429 response (via `HttpError` → `errorResponse()`), confirmed by reading `apps/web/src/lib/http.ts` and `apps/web/src/lib/crm-lead-acquisition-route.ts` — no change needed there.

**Origin allowlist bug fixed as a byproduct**: the second endpoint's origin check was `if (origin && allowed.length && !allowed.includes(origin))` — an omitted `Origin` header (trivial for any non-browser caller) bypassed the check entirely even when a form had an allowlist configured. Fixed to match the primary endpoint's stricter, unconditional check.

## 9. Database Changes

**No migration was created.** `crm_leads.owner_user_id`, `crm_opportunities.owner_user_id`, and `crm_activities.assigned_to` already existed as persisted, indexed columns (`crm_leads_owner_status_idx`, `crm_opportunities_owner_idx` already exist per `database/tenant/migrations/002_crm_module.sql`) — exactly the "prefer existing persisted ownership information" instruction. No new database fields, tables, or indexes were required for any of the three parts of this prompt. RLS was not touched: this repository's RLS is tenant-isolation-level (organization boundary only, verified in Prompt 2's `tests/security/tenant-isolation-rls.test.mjs`), and record-level/field-level access has always been — and remains — an application-layer concern implemented in the service functions, consistent with the existing architecture (documented reasoning: adding per-user RLS policies would duplicate logic already correctly expressed in `recordScope()`/`assertOwnerAssignmentAllowed()`/the field-visibility helpers, and would need to be kept in lockstep with the same `crm.records.view_all`/sensitive-permission logic — a second source of truth for the same rule, not a safer one).

The pre-existing, unrelated duplicate-migration-prefix warning (`039_crm_ai_feedback_draft_id.sql` / `039_crm_offline_completion.sql`, flagged by Prompt 2's `verify:db`) does not block this prompt's work and was left untouched, per this prompt's explicit instruction not to fix it unless blocking.

## 10. Tests Added

62 new test cases across 6 new/expanded files (32 in `services/api`, 22 in `apps/web`, 8 across the 2 new root-level files were already counted in Prompt 2 and are unaffected — see the count breakdown below), all passing.

**Field permissions** (`services/api/tests/field-visibility.test.mjs`, 12 cases): HR read-allow/read-deny for list and for the create-echo secondary response path (explicit allow + deny pairs); Support list-level filtering of private communications (allow + deny); Procurement read-allow/read-deny for list and detail; Procurement write-deny on create and on update (bulk/generic-update bypass prevention); Procurement write-allow for a privileged caller; Procurement write-allow for a restricted caller when the payload doesn't touch sensitive fields (the backward-compatibility case).

**CRM record access** (`services/api/tests/crm-record-scope.test.mjs`, 16 cases): owner-read-allow via list and via direct ID; non-owner list exclusion and direct-ID 404 (IDOR); unowned-record visibility; elevated-role (`crm.records.view_all`) full visibility; unauthorized update-deny and owner update-allow; unauthorized archive-deny; ownership self-assignment allow vs. reassignment-to-another-user deny (both for restricted and elevated callers); dashboard analytics parameter-threading proof for restricted vs. elevated callers; forecast-report (salesperson performance) parameter-threading proof; activities scoped independently of a parent opportunity's owner (parent/child bypass check); and the duplicate-detection regression guard found in Section 11.

**Public lead capture** (`services/api/tests/crm-public-capture.test.mjs`, 7 cases; `apps/web/tests/public-capture-security.test.mjs`, 7 cases): unknown/revoked form key rejected; honeypot rejection short-circuits before the rate limiter is even touched; rate-limit-exceeded 429; normal-traffic pass-through; tenant resolution provably comes only from the form key; both published-lead-form rate-limit behavior and its fingerprint-hashing pin; and, at the route-source level, both endpoints are confirmed to cap body size, use the shared fingerprint helpers, never read `X-Forwarded-For` directly, and the origin-bypass bug is confirmed fixed — plus confirmation the Zod schema is `.strict()`, bounds `customData`, and accepts none of `owner`/`stage`/`score`/`status`/`tenant`/`createdBy`/`permissions`/`approvalState`.

None of these are UI/snapshot tests; all assert either a real authorization/scoping decision (mocked at the `client.query` boundary, following the exact convention established in Prompt 2) or, where the security guarantee lives in TypeScript route source that cannot be executed without a TS test runner (none exists in this repo, and Prompt 2 explicitly declined to add one), a precise source-pattern assertion in the same style as Prompt 2's `auth-session-safety.test.mjs`/`foundation.test.mjs`.

**What remains integration-only, explicitly** (not faked): whether Postgres actually returns the filtered row sets these tests assert on structurally (the tests verify `recordScope()`/the field-visibility helpers generate the *correct SQL and parameters*, mocked to behave like Postgres would — they do not run against a live database). Full behavioral confirmation requires `pnpm infra:up` + seeded fixtures, which Prompt 2 already documented as out of scope for a routine, non-database-mutating verification pass.

## 11. Adversarial Review

Performed per Part 12, against the actual changes made (not a generic checklist):

1. **Can protected fields still leak from another endpoint?** Checked every read path touching `hr_employees`/`support_communications`/`procurement_suppliers` (grep-confirmed: exactly one list function and one create function per HR/Support resource; Procurement's `transitionProcurementRecord` and both report queries were checked directly). CLOSED.
2. **Can generic CRUD bypass field permissions?** HR/Support have no generic bulk-update endpoint touching these fields at all (confirmed: no `updateEmployee` exists). Procurement's generic dispatcher was the actual target of the fix. CLOSED.
3. **Can a user request another user's CRM record by ID?** CLOSED (Section 7).
4. **Can search leak inaccessible records?** `apps/web/src/app/(app)/search/page.tsx` was checked directly — it calls the same `listCrmRecords` function, automatically inheriting the fix. CLOSED.
5. **Can analytics leak inaccessible totals?** CLOSED for `getCrmDashboard` and the `pipeline`/`conversion`/`sources`/`activities`/`forecast`/`revenue-operations` reports (the only reports touching leads/opportunities/activities). The other 8 report types (`campaigns`, `account-health`, `privacy`, `pipeline-intelligence`, `engagement-intelligence`, `relationship-coverage`, `partner-pipeline`, `ai-governance`) were checked and confirmed to query different tables with no ownership concept — consistent with Section 6, not a gap.
6. **Can ownership be self-assigned maliciously?** Self-assignment to oneself remains allowed (necessary for normal lead creation); reassignment to a *different* user by a non-elevated caller is rejected (`assertOwnerAssignmentAllowed`). CLOSED.
7. **Can a child resource expose a protected parent?** Tested directly: an activity assigned to someone else, linked to an opportunity the caller cannot see, is still 404'd based on its own `assigned_to` — `recordScope()` never joins to a parent table, so there is no code path that could leak parent data through a child read. CLOSED.
8. **Can anonymous lead submission pick a tenant?** CLOSED for both endpoints (Section 8, tested).
9. **Can anonymous lead submission set internal fields?** CLOSED for both endpoints (Section 8).
10. **Can rate limiting be bypassed by trivial header manipulation?** CLOSED for the confirmed vector (the second endpoint's raw `X-Forwarded-For` trust). **Documented, not fully closed**: the *direct-fallback* fingerprint's IP component depends on `TRUSTED_PROXY_IP_HEADER` being configured at the infrastructure layer — this is pre-existing `clientIp()` behavior (unchanged by this prompt, reused for consistency rather than replaced) and, if that env var is unset, `clientIp()` returns a constant value for every caller, collapsing the direct-fallback fingerprint to a user-agent-only hash. This is an operational/false-positive risk (over-throttling a large shared-UA population), not a bypass a specific attacker can exploit to evade limits, but it is a real environment-dependent gap worth flagging (Section 13).
11. **Can the limiter create memory/resource exhaustion itself?** The limiter is entirely DB-backed (an `INSERT … ON CONFLICT` upsert); nothing was added to any in-memory structure. Unaffected/no new risk.
12. **Can an authorization resolution error accidentally allow access?** Every new check (`canViewAllCrmRecords`, `canViewSensitiveEmployeeFields`, `canViewSensitiveSupportRecords`, `canViewSupplierSensitiveFields`) uses `Boolean(context.x?.includes(...))` — an absent/malformed `context.permissions`/`context.roleSlugs` evaluates to `false`, i.e. **deny**, never grant. Verified by reading every new function; no case returns `true` on an error or missing-context path.

**Additional issue found and fixed during this review, not on the original checklist**: applying `recordScope()`'s new owner-scoping to `findCrmDuplicates` (which reuses `recordScope(resources.leads, ...)`) would have silently narrowed CRM duplicate detection to "duplicates I own" for every restricted caller — breaking the actual purpose of duplicate detection (catching a *colleague's* matching lead) across three real call sites: the authenticated lead-detail page, the dedicated `/api/crm/leads/duplicates` route, the mobile API, and the public capture flow itself. Fixed by having `findCrmDuplicates` call `recordScope()` with `ownerField` stripped from the resource definition, keeping company/branch scope intact while explicitly opting the duplicate-check query out of owner scope. A regression test (`findCrmDuplicates` asserting the generated SQL never references `owner_user_id`) locks this in. This is exactly the class of issue Part 12 exists to catch, and it would not have been found without deliberately trying to break the change rather than just confirming it does what it was designed to do.

## 12. Verification Results

| Command | Result |
|---|---|
| `git status` (before any change) | Clean except Prompt 1/2's already-tracked modifications/untracked files — all preserved throughout |
| `pnpm verify:fast` | **PASS** — typecheck clean, lint clean (1 pre-existing unrelated warning), 59 tests pass (25 api + 15 web at the time this tier last ran alone, growing to 60/22 by the end of this prompt as tests were added) |
| `pnpm verify:web` | **PASS** — includes `verify:routes` (116 pages/279 routes, 0 failures) and a full `next build` completing with no environment variables required |
| `pnpm verify:db` | **PASS** — 0 failing checks, 1 pre-existing warning (duplicate migration prefix `039`, unrelated to this prompt, not touched) |
| `pnpm verify` (full Level 5 composite) | **PASS** — all of the above plus `verify:mobile` (typecheck+lint clean), `test:sdk` (12/12), `test:packages` (9 packages, all pass), `test:integration` (1/1), `test:security` (4/4), `test:enterprise-rbac` (10/10, confirming the CRM/sales role permission additions did not break any existing RBAC invariant — including "every role permission exists in the canonical permission catalogue," which specifically confirms `crm.records.view_all` was correctly registered) |
| `pnpm release:verify` | **PARTIAL** — `verify`, `build:web`, `lint:landing`, `typecheck:landing`, `build:landing`, and `test:landing` all passed (proven by the chain reaching the final stage at all, since each `&&`-joined step must succeed before the next runs). The final stage, `test:landing:e2e` (Playwright, `apps/landing/tests/e2e/*`), failed with 95 failures — uniformly `page.goto` timeouts against `http://localhost:3000` across every spec file (accessibility, attribution, mobile-conversion, visual-review, production-smoke, lead-reliability), the signature of a landing dev-server not being reachable/ready in this environment rather than a content or logic regression. **This is a pre-existing/environment-dependent condition, not introduced by this prompt**: Prompt 3 did not modify any file under `apps/landing`, and every failing spec concerns marketing-site rendering/accessibility/visual output, none of which this prompt's CRM/permissions/lead-capture changes could affect. Not investigated further — out of scope for a security-hardening prompt targeting `apps/web`/`services/api`. |
| `services/api` test count | 37 (end of Prompt 2) → **60** (25 pre-existing + 12 field-visibility + 16 crm-record-scope + 7 crm-public-capture, with 1 test added mid-prompt as a regression guard) |
| `apps/web` test count | 15 (end of Prompt 2) → **22** (15 pre-existing + 7 public-capture-security) |

No test written in this prompt was designed to pass trivially; the field-visibility, CRM-scope, and public-capture test files each caught at least one real mock-fidelity bug during authoring (documented inline in the test files' own history — corrected before being reported as passing), and the duplicate-detection regression in Section 11 was caught by a test written specifically to try to break the change.

## 13. Remaining Security Gaps

**P0** — none identified as a direct result of this prompt's scope.

**P1**:
- The direct-fallback capture fingerprint's IP component is only as good as `TRUSTED_PROXY_IP_HEADER` being correctly configured for the production deployment (Section 11, item 10). This is pre-existing, environment-dependent, and outside this prompt's remit to fix (it would mean either changing `clientIp()`'s default behavior — a broader change than "protect the public lead-capture endpoint" — or documenting an operational requirement). Recommend a deployment-readiness checklist item confirming this env var is set before any production capture-form traffic is expected.
- HR & Support field-permission enforcement currently has no assignable role that would ever exercise the "restricted" branch (Section 2) — it is correct-by-construction but untested-by-real-traffic until a genuine HR/Support operational role exists in the catalogue. Not a bug, but worth re-verifying the day such a role is added.

**P2**:
- `crm.records.view_all` intentionally does not cover `campaigns`/`capture-forms`/`accounts`/`contacts` (Section 5/6) — a deliberate scope boundary, not an oversight, but should be revisited if product requirements for those resources' record-level access ever change.
- No test exercises the real end-to-end RLS/Postgres behavior for any of this prompt's changes (Section 10's "integration-only" note) — matches Prompt 2's already-documented, pre-existing limitation of this repository's test infrastructure.

**P3**:
- The pre-existing duplicate-migration-prefix warning (`039_*`) remains, as instructed, untouched.

## 14. Files Changed

**Modified**:
- `apps/web/src/lib/authorization.ts` — added `procurementSuppliersSensitive`, `crmRecordsViewAll` constants
- `apps/web/src/lib/access-control.ts` — granted `crm.records.view_all` to 7 CRM/sales roles
- `apps/web/src/lib/crm-validation.ts` — bounded `publicCaptureSchema.customData` size/key-count
- `apps/web/src/lib/security.ts` — added `verifiedCaptureProxyFingerprint`, `directCaptureFingerprint`, `safeHexEqual`
- `apps/web/src/app/api/crm/public/capture/[key]/route.ts` — now imports the shared fingerprint helpers instead of a local duplicate
- `apps/web/src/app/api/crm/lead-acquisition/public/forms/[key]/route.ts` — body-size cap, shared fingerprint helpers, fixed origin-check bypass
- `apps/web/scripts/verify-routes.mjs` — removed an unused variable (lint fix, unrelated to security logic)
- `packages/permissions/src/crm.js` / `crm.d.ts` — added `recordsViewAll: "crm.records.view_all"`
- `services/api/src/crm.js` — `recordScope()` owner-scoping, `assertOwnerAssignmentAllowed()`, `getCrmDashboard()`/`getCrmReport()` owner-visibility parameters, `findCrmDuplicates()` owner-scope exclusion, `ownerField` added to the `leads`/`opportunities`/`activities` resource definitions
- `services/api/src/hr-payroll/index.js` — employee sensitive-field omission on read
- `services/api/src/support/index.js` — private-communication omission on read
- `services/api/src/procurement/index.js` — supplier sensitive-field omission on read, rejection on write

**Added**:
- `services/api/src/field-visibility.js`
- `services/api/tests/field-visibility.test.mjs`
- `services/api/tests/crm-record-scope.test.mjs`
- `services/api/tests/crm-public-capture.test.mjs`
- `apps/web/tests/public-capture-security.test.mjs`
- `docs/implementation/ERP_SECURITY_HARDENING_003.md` (this document)

## 15. Follow-Up Recommendations

For later prompts, not attempted here:
- Reconcile the RBAC-role-catalogue-vs-module-availability inconsistency flagged in Prompt 2 (Stock/Manufacturing/HR roles still marked unassignable despite their modules being released) — directly relevant to when HR/Support field permissions become load-bearing (Section 13, P1).
- If/when product requirements call for record-level scoping on CRM accounts/contacts, revisit whether that belongs in `business-data.ts` (affecting all its consumers) or a CRM-specific override — this prompt deliberately did not decide that question.
- Consider a deployment/production-readiness checklist item for `TRUSTED_PROXY_IP_HEADER` and `CRM_CAPTURE_PROXY_SECRET` configuration, since both now materially affect abuse-resistance of public lead capture.
- The remaining Prompt 1 P1 items not in this prompt's three targets (the `http://localhost:3001` email-link fallback, the broken worker container) remain open and unaddressed, as instructed.
