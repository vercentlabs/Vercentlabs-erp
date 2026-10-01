# CRM final architecture and release audit

Status: final audit of the CRM architecture refactor programme (Prompts 2–10),
taken at HEAD `c16ba352` on `main` on 2026-10-02. This audit changed no runtime
code. Every count below was recomputed from the tree at that commit; where an
earlier prompt report disagrees, this document is the correction.

Severity taxonomy used throughout:

| Severity | Meaning |
|---|---|
| **P0** | Security or data-integrity defect that is reachable by an ordinary user in a supported flow. Blocks release. |
| **P1** | A primary user journey is broken or produces wrong business results. Blocks release of the affected surface. |
| **P2** | A secondary flow fails or degrades, or a hardening gap with bounded impact. Release with an owner and a date. |
| **P3** | Cosmetic, logging, latent or low-impact defect. |
| **ARCH-DEBT** | Correct behaviour, but structure that violates or strains the intended architecture. |
| **TEST/DEV-ENV** | Test-suite or developer-environment problem; no product impact. |

## 1. Release verdicts

| Surface | Verdict | Reason |
|---|---|---|
| A. CRM architecture refactor (Prompts 2–10) | **COMPLETE** | All structural targets met and enforced by rules (§3–§6); no runtime behaviour change found. |
| B. Web CRM product | **BLOCKED** | P0 `SALES-SCOPE` (§8.1): Sales lists and links CRM Opportunities outside the caller's CRM record scope. |
| C. Public CRM endpoints (capture, booking) | **RELEASE WITH ACCEPTED DEBT** | P2 `CAPTURE-LIMIT` and P2 `F014-CANCEL` (§8.4, §8.5). |
| D. Mobile CRM | **BLOCKED** | P1 `MOBILE-V1`: the mobile client's whole `/api/mobile/v1` API (including sign-in) has no route handlers (§8.2). |
| E. Worker (CRM jobs) | **RELEASE WITH ACCEPTED DEBT** | P2 `AUTOMATION-ACTIVITY`, P3 `WORKER-ORGIDS` (§8.3, §8.6). |
| F. SDK (`@vercentlabs/shared-sdk` CRM client) | **RELEASE WITH ACCEPTED DEBT** | P3 `SDK-COMPLETE`: `crm.completeActivity` targets a missing route; no first-party caller (§8.7). |

## 2. Release-blocker matrix

| ID | Severity | Surface | Blocks | Evidence | Fix owner (proposed) |
|---|---|---|---|---|---|
| SALES-SCOPE | P0 | Web CRM, Sales | B | §8.1 probe: a `sales_representative` whose CRM scope shows 100 own open Opportunities receives 200 from `GET /api/sales/options`, 142 owned by other users; a `finance_manager` with no `crm.view` receives 200, 199 owned by others. Quotation create accepts any of them as `opportunityId`. | Sales + CRM: route Sales' Opportunity reads through a CRM scoped query contract. |
| MOBILE-V1 | P1 | Mobile | D | §8.2: `packages/shared-sdk/src/mobile.js` roots every call at `/api/mobile/v1`; `apps/web/src/app/api/mobile` does not exist (removed in `49b80eeb`); `apps/mobile` signs in through `mobileApi.login` → `/api/mobile/v1/auth/login`. | Mobile/Platform: restore a mobile API or move the client to the web API. |

No other finding blocks a release surface.

## 3. Authoritative metrics (recomputed at `c16ba352`)

### 3.1 Backend CRM module (`services/api/src/modules/crm`)

| Metric | Value |
|---|---|
| Runtime files (`.js`, excluding tests) | 123 (122 in eight capabilities + `index.js`) |
| File-level import edges inside CRM | 498 |
| Strongly connected components | 2 (5 files; largest 3) |
| Capability-level edges | 31; two-way pairs 7 |
| Runtime self-boundary imports (`../index.js` from inside CRM) | 0 |
| Declaration (`.d.ts`) self-boundary imports | 6 (type-only, see §7.4) |

Both SCCs equal `CRM_ALLOWED_RUNTIME_CYCLES` exactly:

- lifecycle trio: `stage-catalog → stage-migration {STAGE_MIGRATION_JOB_TYPE}`, `stage-migration → transition-engine {transitionLeadStage}`, `transition-engine → stage-catalog {listLeadStageHistory}`;
- `automation/automation-engine ↔ resource-mutation-service` (`{createCrmRecord, updateCrmRecord}` / `{runCrmAutomation}`).

Two-way capability pairs: activities↔data-management, data-management↔lead-management, data-management↔master-data, data-management↔pipeline, data-management↔sales-organization, lead-management↔master-data, lead-management↔sales-organization. None is a file cycle; all are allowed by the rules.

### 3.2 Per-capability table

Edge counts are import statements crossing a capability boundary (`in` includes `index.js`; `out` includes imports leaving the CRM module, shown as `..`).

| Capability | Files | Export declarations | In (from) | Out (to) | Largest file (lines) | README |
|---|---|---|---|---|---|---|
| activities | 22 | 145 | 17 (root, data-management) | 58 (.., data-management, lead-management, master-data) | `communications/email-service.js` 752 | yes |
| analytics | 5 | 35 | 7 (root, sales-organization) | 17 (.., data-management) | `forecast-service.js` 617 | yes |
| conversions | 1 | 2 | 1 (root) | 10 (data-management, master-data) | `lead-conversion.js` 303 | yes |
| data-management | 22 | 151 | 173 (all) | 26 (.., activities, lead-management, master-data, pipeline, sales-organization) | `resource-registry.js` 1251 | yes |
| lead-management | 27 | 189 | 44 | 26 | `lead-intelligence.js` 787 | yes |
| master-data | 29 | 155 | 29 | 38 | `lead-acquisition.js` 1179 | yes |
| pipeline | 13 | 105 | 10 (root, data-management) | 36 (data-management, lead-management, master-data) | `opportunity-revenue-intelligence.js` 1063 | yes |
| sales-organization | 3 | 14 | 5 | 14 | `coverage-service.js` 360 | yes |

### 3.3 `data-management` kernel

`data-management` is the shared record kernel: 173 incoming cross-capability import statements, 19 outgoing file edges to other CRM capabilities (26 statements including `..`). The 19 outgoing edges, all one-way rule hooks or security projections:

- → activities (2): `offline-sync.js` replays Task and Follow-up commands.
- → lead-management (9): security projections (`lead-security.js` ×6 importers), `resource-mutation-service.js` → `lead-record-rules.js`, `resource-options.js` → assignee eligibility, `resource-validation.js` → `qualification-fields.js`.
- → master-data (4): Account/Contact security projections, Lead import → `lead-acquisition.js`, `record-utils.js` → lead-source validation.
- → pipeline (2): `offline-sync.js` → `moveOpportunityStage`; mutation service → `opportunity-record-rules.js`.
- → sales-organization (2): hierarchy rules, territory normalisation.

Classification: kernel files (errors, record-policy, access scope, record-utils, outbox, resource layer, condition-matching, entity/communication access, activity-query-rules), feature files it owns (F021 `import-export/`, F028 `custom-field-runtime.js`, `tag-assignment.js`, F029 bulk), automation (`automation/automation-engine.js`) and `offline-sync.js`, `notification-visibility.js`. Verdict **ARCH-DEBT (accepted)**: the kernel still hosts three feature areas (F021/F028/F029) and the automation engine; the import direction is enforced (`checkCrmKernelImportBans`) so it cannot grow new edges silently.

### 3.4 Package boundary (`@vercentlabs/api` vs `@vercentlabs/api/crm`)

| Metric | Value |
|---|---|
| Package-root runtime exports | 1752 |
| of which CRM-owned | 558 |
| `@vercentlabs/api/crm` exports | 319 |
| Overlap (CRM names on both) | 319 |
| **Root-only CRM names** | **239** |
| Subpath-only | 0 |
| Subpath typed names | 319 values (= runtime) + 13 type-only |
| Root CRM runtime names without a root declaration | 25 |

The Prompt 10 report's "249 root-only" was stale; the snapshot test pins 558/319 and 239 = 558 − 319.

### 3.5 Legacy compatibility classes (root-only names, 239)

| Class | Meaning | Count |
|---|---|---|
| A | used by a first-party runtime consumer via the root | 0 |
| E | used by non-CRM server code | 1 |
| B | used only inside CRM | 49 |
| C | used only by tests/scripts | 71 |
| D | unreferenced | 118 |

The Prompt 8 classifier reports E = 8 because it counts the compat barrel `services/api/src/compat/crm-root-legacy.js` as a cross-module user. Excluding the barrel's own re-exports, seven of those names (`SCORE_RECALC_BATCH_SIZE`, `dismissAccountDuplicateMatch`, `dismissContactDuplicateMatch`, `enqueueLeadScoreRecalcJob`, `findLeadContactCrossMatches`, `getLeadScoreRecalcJob`, `recordContactDuplicateOverride`) fall into B/C. The table above is the corrected result.

The single Class E name is `redactInaccessibleCrmNotifications`. Owner: `modules/crm/data-management/notification-visibility.js`. Consumer: `services/api/src/orchestration/notifications/visibility.js`, which imports the file directly (`../../modules/crm/data-management/notification-visibility.js`), bypassing `modules/crm/index.js`. Severity **ARCH-DEBT**. Behaviour is correct. `verify-architecture` enforces the module boundary only for other modules, not for orchestration.

Retirement estimate for the compat barrel: one small, mechanical prompt.
- D (118): delete.
- C (71): move test imports to `@vercentlabs/api/crm` or to the owning file.
- B (49): drop from the root.
- E (1): add `redactInaccessibleCrmNotifications` to the CRM boundary and point orchestration at it.
- A (0): no runtime caller migrates.

This is a deliberate breaking change for external package consumers; the export snapshot must be updated in the same commit.

### 3.6 Web CRM feature (`apps/web/src/features/crm`)

| Metric | Value |
|---|---|
| Files | 233 |
| Internal import edges | 559 |
| SCCs | 0 |
| Areas | customers 39, data 17, home 6, inbox 3, insights 5, pipeline 25, public 9, setup 58, shared 42, work 28, root `index.ts` |
| `*-api.ts` browser clients | 39 |
| Local response decoders (`.json()` outside `shared/http`) | 0 |
| `extends Error` outside `shared/http` | 0 |
| Literal / unscoped `queryKey` arrays | 0 (16 key variables, all `scopedQueryKey`) |
| CRM API route files / CRM pages / public CRM routes | 177 / 53 / 6 |

Cross-area edges that are deliberate API reuse, not ownership errors:
- Lead Detail → `setup/privacy-requests` API.
- Lead Sources settings → `home/dashboard` API.
- Reports and Forecast → `home/dashboard` `MetricDrilldownDialog`.
- Duplicates workspace → customers APIs and panels.
- Account/Contact detail → `pipeline/opportunities` API.
- My Work → Inbox.

`shared/` depends on areas in two runtime files: `shared/ui/RelatedRecordCard.tsx` and `RelatedRecordPicker.tsx` import the Account/Contact/Lead/Opportunity API clients. That is 8 edges, plus 8 test-only edges in `shared/http/crm-request.test.ts`. Severity **ARCH-DEBT**: shared UI should receive loaders by injection. There is no cycle.

Screens over 800 lines (structure debt, P3/ARCH-DEBT):

| Screen | Lines | useQuery | useMutation | useState |
|---|---|---|---|---|
| `LeadListScreen.tsx` | 931 | 2 | 0 | 10 |
| `OpportunityDetailScreen.tsx` | 896 | 4 | 4 | 11 |
| `AssignmentPoliciesSettingsScreen.tsx` | 826 | 5 | 5 | 23 |
| `CrmDashboardScreen.tsx` | 822 | 3 | 0 | 4 |

Lead Detail is pinned by `customers/leads/detail/lead-detail-structure.test.ts`, which records the same reads, writes, invalidations, tabs, permission gates and dialogs as the pre-split screen:
- 15 query keys, 9 query functions, 6 mutations, 5 invalidations;
- 10 tabs, 8 titled states and dialogs, 2 permission gates.

## 4. Browser HTTP boundary

All CRM browser clients go through `features/crm/shared/http/crm-request.ts` (`parseCrmResponse`, `crmRequest`, `crmApiClient`) on `shared/http/request-json.ts`. Error classes: `CrmApiError`, `CrmApiErrorWithBody`, `CrmApiErrorWithDetails`. This is enforced by `checkCrmBrowserClients`.

Null-body reachability: `readJsonResponse` treats an unreadable body as `{}` and an error payload `null` as `{}`. A 2xx body of literal `null` would be returned as `T`, but a grep for `json(null` and `new Response(null` under `app/api/crm` found no route that sends a `null` body; CRM handlers reply through `ok(...)`/`errorResponse(...)` envelopes. Unreachable; no finding.

React Query isolation: every CRM key starts with `scopedQueryKey(workspace, …)`, so cache entries are partitioned by organisation/company/branch. No finding.

## 5. Routes, SDK, mobile, worker

- **Route thinness:** 0 of 177 CRM route files issue SQL. The 11 route files that still import `@vercentlabs/api` (root) import only Shared Platform names: `audit`, `directCaptureFingerprint`, `getDataExchangeDefinition`, `incrementBillingUsage`, `parseCsvUpload`, `prepareFileUpload`, `readRequestBytes`, `requireBillingWriteAccess`, `requireSessionPermission`, `rowsToCsv`, `verifiedCaptureProxyFingerprint`. They are accepted by `checkApiRootCrmBoundary`. 176 route files import `@vercentlabs/api/crm`.
- **SDK transport contract** (`packages/shared-sdk/tests/crm-transport-contract.test.mjs`, 3/3 pass): every CRM client method resolves to a route handler except the pinned `KNOWN_MISSING` list, which is `crm.completeActivity` (`POST /api/crm/activities/{id}/complete`) plus every `mobile` CRM method.
- **Mobile:** see §8.2.
- **Worker:**
  - 17 CRM handlers (`services/worker/src/handlers/crm-*.js`);
  - imports: 17 statements from `@vercentlabs/api/crm`, 8 from `@vercentlabs/api` (2 of which still carry 4 CRM names that are also on the subpath; ARCH-DEBT, cosmetic);
  - 15 direct `tenant.crm_*` SQL statements, all job-item or batch bookkeeping tables owned by the job they run (`crm_lead_bulk_job_items`, `crm_opportunity_bulk_job_items`, `crm_lead_import_batches`/`rows`, and 2 reads of `crm_activities` in `crm-automation-overdue.js`). ARCH-DEBT (accepted).

## 6. Rules and enforcement

`scripts/validation/architecture-rules.mjs` exports 24 `check*` rules with 21 rule tests. CRM-specific rules:
- `checkCrmSelfBoundaryImports`
- `checkCrmCapabilityImportBans`
- `checkCrmKernelImportBans`
- `checkCrmRuntimeCycles` (exact allowlist)
- `checkApiRootCrmBoundary`
- `checkCrmCompatibilityBarrels`
- `checkCrmBrowserClients`
- `checkCrmWebOwnership`

Package and contract guards:
- `services/api/tests/crm-public-api-exports.test.mjs` (snapshot 558/319);
- `services/api/tests/crm-package-boundary.test.mjs`;
- the SDK transport contract;
- `scripts/validation/verify-crm-module-contracts.mjs`.

## 7. Cross-module and data-model audit

### 7.1 Customer 360

Customer 360 (`master-data/accounts/customer-360.js`) reads Sales and Accounting tables. Each read is scoped by `crmChildScopes`:
- Sales documents need `salesDocumentVisibilitySql` (`sales.view` plus company);
- receivables use their own predicate;
- service events are company-scoped.

Security-correct. **ARCH-DEBT:** these are raw reads of other modules' tables rather than their query contracts.

### 7.2 Support → CRM service events

`modules/support/tickets.js` `syncCrmServiceEvent` writes `tenant.crm_customer_service_events` directly (`INSERT … ON CONFLICT DO UPDATE`). It bypasses the governed `recordCustomerServiceEvent`, which applies a scope check, type validation and a title requirement.
- **ARCH-DEBT:** the write crosses the module boundary.
- **P3 latent bug:** the statement is wrapped in `try {} catch {}` without a savepoint. A failing insert would leave the Support transaction aborted, so the ticket write fails later with "current transaction is aborted".

### 7.3 Account/Contact merge

`master-data/merge/record-merge.js` repoints every foreign key found in `pg_constraint`:

| Merged record | Tables repointed | Including |
|---|---|---|
| `business_parties` | 47 | Accounting 12, Sales 3, POS 4 |
| `contacts` | 24 | Sales 2 |

- A unique-key conflict maps to 409 `CRM_MERGE_RELATIONSHIP_CONFLICT`.
- **P2 functional gap:** merging an Account that has posted accounting rows (`journal_lines`, posted invoices, posted bills) hits the immutability triggers. The raised exception is not mapped, so the whole merge rolls back with a 500-class error. The data stays consistent.
- **ARCH-DEBT (high risk):** CRM rewrites draft Sales and POS rows without telling those modules. This belongs in `services/api/src/orchestration` with per-module commands.

### 7.4 Declaration debt

16 of the 34 standalone `tsc` diagnostics on the package declarations are CRM:
- 6 `.d.ts` files import `CrmContext`/`QueryClient`, which are declared but not exported (`custom-field-runtime`, `tag-assignment`, `lead-source-operations`, `pipeline-snapshots`, `sales-stage-operations`, `stage-aging`);
- `attachments-operations.d.ts` imports a missing `CrmContext`;
- 3 files reference `Buffer` without Node types.

The six type-only self-boundary imports in `.d.ts` files (§3.1) are related declaration debt. Severity **ARCH-DEBT/P3**. Consumers compile with `skipLibCheck`, so there is no runtime effect.

### 7.5 Custom fields

There are three models, which are not duplicates:

| Model | Purpose | Live rows |
|---|---|---|
| CRM custom objects (`crm_custom_object_definitions`, `crm_custom_field_definitions`, `crm_custom_records`) | User-defined record types | 2 / 8 / 60 |
| Platform `custom_field_definitions` / `custom_field_values` | Extra fields on built-in entities (`data-management/custom-field-runtime.js`) | 9 / 8 |
| Legacy `custom_data` JSONB | — | 0 Leads with data |

The legacy `custom_data` JSONB column is still referenced in 10 backend and 5 web files. **ARCH-DEBT:** dormant column to retire.

### 7.6 Web-owned authorization

The generic resource route `app/api/crm/[resource]/route.ts` enforces per-resource manage permissions with `assertCrmResourceMutationPermission` (`features/crm/shared/crm-context.ts`). This is server-side route code, so it is security-correct. `services/api` `createCrmRecord` has no per-resource manage check of its own, so a future server caller (worker, orchestration) would bypass it. **ARCH-DEBT.**

### 7.7 Sales → CRM Opportunity sync

`orchestration/sales-crm-opportunity-sync.js` reads `crm_opportunities`, `crm_pipeline_stages` and `crm_lost_reasons` directly, then moves stages through the governed `moveOpportunityStage`. **ARCH-DEBT** (raw reads). The write path is correct.

## 8. Defect register

### 8.1 SALES-SCOPE — P0 — Sales exposes and links out-of-scope CRM Opportunities

- `services/api/src/modules/sales/index.js` `getSalesOptions` selects `id, company_id, branch_id, party_id, contact_id, owner_user_id, name, amount, currency_code, expected_close_date FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open'` plus a company clause, `LIMIT 200`. There is no CRM owner, team or territory scope.
- The route `/api/sales/options` is gated only by `sales.view`. With an `opportunityId` it also returns that Opportunity's line items.
- `createQuotation` accepts any non-archived Opportunity in the organisation whose party matches. Its audit trail is `sales_document_events` (`quotation.created`); it has no CRM scope check.
- The F023 UI (`OpportunityDetailScreen`) gates the hand-off on `sales.quotation.create` plus `opportunity.partyId` only.

Proof: a read-only probe ran in a rolled-back transaction on the local demo database, with the real branch context.

| Role | CRM-scope open Opportunities | Sales options | Owned by someone else |
|---|---|---|---|
| `sales_representative` | 100 own of 102 | 200 | 142 |
| `finance_manager` (no `crm.view`) | n/a | 200 | 199 |

Role templates with `sales.view` but no `crm.records.view_all`: `sales_manager`, `sales_representative`, `finance_manager`, `support_manager`.

Impact: cross-user disclosure of deal name, amount, currency, close date and owner, and linking of quotations to deals the user cannot open in CRM.

Also P3 in the same function: `Promise.all` issues concurrent queries on one `pg` client. This triggers pg's deprecation warning and will fail on pg 9.

### 8.2 MOBILE-V1 — P1 — Mobile app has no server API

- `createMobileClient` roots calls at `${baseUrl}/api/mobile/v1` (`packages/shared-sdk/src/mobile.js:78`).
- No `apps/web/src/app/api/mobile` tree exists; it was removed in `49b80eeb`.
- `apps/mobile` uses `mobileApi.login`, `session`, `listCrm`, `getCrm`, `createCrm`, `completeActivity`, call/meeting commands, notifications and workspace calls, all under that prefix.
- The SDK contract test pins all 15 mobile CRM methods as `KNOWN_MISSING`.

Result: the mobile app cannot sign in. `CRM_MOBILE_CAPABILITY_MATRIX.md` and the mobile columns of `CRM_F001_F030_COMPLETION_MATRIX.md` describe a server surface that no longer exists.

### 8.3 AUTOMATION-ACTIVITY — P2 — `create_activity` automation always fails for typed activities

- `data-management/automation/automation-engine.js` `create_activity` calls `createCrmRecord(…, "activities", { activityType: action.activityType || "task" })`.
- `resource-mutation-service.js` rejects `task`, `call`, `meeting` and `follow_up` with 410 (`CRM_TASK_API_MOVED`, etc.).
- The rule runs inside a savepoint. The whole rule rolls back, a `failed` row lands in `crm_automation_runs`, and the triggering mutation still succeeds.

Effect: silent loss of automated follow-ups. CRM automation rules have no dedicated UI, which limits exposure.

### 8.4 CAPTURE-LIMIT — P2 hardening — public capture limiter keyed on IP + User-Agent

The direct path of `app/api/crm/public/capture/[key]/route.ts` fingerprints `sha256(clientIp|user-agent)`. Rotating the User-Agent gives a fresh hourly bucket in `crm_capture_rate_limits`. Unlike the public meeting and quote routes, the route does not use `enforcePublicRateLimits`.

Mitigations present:
- allowed origins and honeypots;
- 50 KB body cap and required fields;
- billing gate;
- HMAC-signed proxy path;
- trusted-proxy IP resolution (`"unavailable"` in production without the header).

Impact: spam leads and usage inflation. No disclosure.

### 8.5 F014-CANCEL — P2 — public booking cancel does not cancel the calendar event

`activities/meetings/meeting-booking.js`:
- Cancel runs `UPDATE crm_calendar_events SET provider_status='cancelled' WHERE meeting_booking_id=$2`. Calendar events link through `activity.meeting_calendar_event_id`, so this matches nothing.
- The activity is cancelled by direct SQL rather than the governed meeting cancel, so no provider push happens.

With calendar sync on, the external event stays and its slot can stay busy in availability.

Proven live by `scripts/validation/verify-crm-f014-live.mjs`, whose only failing check is `publicBookingCancelSynchronized: false` (§11). The code is unchanged since before the refactor programme.

### 8.6 WORKER-ORGIDS — P3 — `pollOnce` logs an undefined variable

`services/worker/src/worker.js` logs `organizations: organizationIds.length`; the variable is `pending`.
- It throws `ReferenceError` only when a poll processed work, and only after the work completed and `health.pollCompletedAt` was set.
- `tick()` catches it, sets `lastPollError` and logs "poll crashed".
- Readiness uses `pollCompletedAt`, so it is unaffected. No data impact; the error logs are false and the poll summary is lost.
- No test covers it.

### 8.7 SDK-COMPLETE — P3 — `crm.completeActivity` targets a missing route

`POST /api/crm/activities/{id}/complete` does not exist; completion is per type. There is no first-party web caller; the mobile caller is covered by MOBILE-V1. Pinned in `KNOWN_MISSING`.

### 8.8 SUPPORT-SAVEPOINT — P3 latent

See §7.2.

### 8.9 MERGE-POSTED — P2

See §7.3.

### 8.10 ABORTED-REQUEST — P3 — client aborts are logged as unhandled server errors

When the browser abandons a request mid-flight (the composing-time duplicate check is cancelled as the user types; tests close pages), Node's `http` server raises `Error: aborted` (`ECONNRESET`, `abortIncoming`) on the request stream:
- `readJson` inside `workspaceRoute` throws it, the transaction rolls back and the route reports `http.unhandled_error` at severity ERROR;
- Next additionally prints `uncaughtException: Error: aborted`.

Captured in this audit's Linux E2E reruns (`crm-mvp` Journey B) while the tests passed, and present at the pre-programme baseline. No data impact: nothing was written before the body was read, and the client no longer waits for the reply. The cost is error-level log noise for normal user behaviour, and it masks real errors.

Earlier Journey A/B/C failures that coincided with these aborts did not reproduce in this audit (§11). Classified **TEST/DEV-ENV** (timing on a loaded host). The abort logging itself stays P3.

### 8.11 REPORTS-BACK — P3 — back navigation across a reload shows the wrong report

`e2e/crm-navigation.spec.ts` Journey 2 fails deterministically at line 193:
1. Open `/crm/reports?report=forecast`, pick Pipeline, apply "Last 30 days", then reload.
2. Go back twice. The URL returns to `report=forecast`, but the screen still renders "Pipeline by stage".

`CrmReportsScreen` derives the report only from `useSearchParams()`, has no history handling of its own, and Next 16.3.6 runs with no experimental flags. The restored history entries were created by `router.push` before the hard reload, and after `popstate` the client screen is not re-rendered for the restored search parameters. The defect sits in how the app router restores pre-reload entries, not in CRM code.

The same assertion fails at the pre-programme baseline (E2E run of 2026-10-01 before `58d3cdde`), so the refactor did not cause it. User impact: after a refresh, Back shows a mismatched report until the next navigation. Because the spec runs in serial mode, the three Journeys after it are skipped in a full run; they are run separately in §11.

### 8.12 OPP-LIST-URL — P3 — the Opportunities list rewrites its URL on mount

`pipeline/opportunities/screens/OpportunityListScreen.tsx` runs a mount effect that `router.replace`s `/crm/opportunities?<filters>`. It rebuilds the query from its filters only, so `?view=list` becomes `?offset=0`.

The list is the default view, so the screen behaves the same. However:
- the URL a user shares loses its view;
- `crm-navigation` Journey 1 flakes on it (§11).

Pre-existing (identical at `0836aed8`).

### 8.13 BOOKING-E2E-FLAKE — TEST/DEV-ENV — unexplained public-booking load failures

See §11. Recorded so it is not mistaken for a refactor regression.

"The request could not be completed." is both the server's message for an unclassified 500 (`apps/web/src/core/http-errors.ts`) and the browser client's fallback. The pre-programme `public-booking-api.ts` used the identical fallback and failure test; the Prompt 9 swap-original proof covers that equivalence.

The most likely explanation is a transient server-side failure on the container → host database path; Prompt 9 saw host-DB connect timeouts. That was not proven here. The backend booking paths pass `verify-crm-f014-live` except for F014-CANCEL.

## 9. Accepted debt

| ID | Kind | Where | Why accepted now | Retire by |
|---|---|---|---|---|
| COMPAT-ROOT | ARCH-DEBT | `services/api/src/compat/crm-root-legacy.*` (239 root-only names) | Breaking for package consumers; no first-party runtime use | Compat retirement prompt (§3.5) |
| KERNEL-FEATURES | ARCH-DEBT | `data-management` hosts F021/F028/F029 and automation | Direction enforced by rules | Split into feature capabilities |
| CYCLES-2 | ARCH-DEBT | lifecycle trio, automation↔mutation | Exact allowlist, no growth possible | Event/command inversion |
| ORCH-BYPASS | ARCH-DEBT | `orchestration/notifications/visibility.js` | Correct behaviour | Add to the CRM boundary |
| SHARED-UI-DEPS | ARCH-DEBT | `RelatedRecordCard/Picker` | No cycle | Inject loaders |
| LARGE-SCREENS | ARCH-DEBT | 4 screens > 800 lines | Pinned behaviour | Decompose |
| CUSTOMER-360-READS, SALES-SYNC-READS, SUPPORT-WRITE, MERGE-CROSS-WRITE | ARCH-DEBT | §7 | Scoped/correct today | Module query/command contracts + orchestration |
| WEB-AUTHZ | ARCH-DEBT | `[resource]` route permission check | Server-side, correct | Move into `services/api` |
| DECL-DEBT | ARCH-DEBT/P3 | 16 CRM `.d.ts` diagnostics | `skipLibCheck` | Export `CrmContext`/`QueryClient`, add Node types |
| CUSTOM-DATA | ARCH-DEBT | legacy `custom_data` | 0 rows with data | Contract migration |
| WORKER-ROOT-NAMES | ARCH-DEBT | 4 CRM names via root in worker | Same functions | Import from subpath |

## 10. Traceability F001–F030 (current state)

Web status is taken from `CRM_F001_F030_COMPLETION_MATRIX.md` Part 2, re-checked against this audit.

| F-ID | Web | Mobile | Audit notes |
|---|---|---|---|
| F001 Leads | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F002 Accounts | CLOSED | WEB_WORKSPACE | Merge: MERGE-POSTED (P2) |
| F003 Contacts | CLOSED | WEB_WORKSPACE | Merge: MERGE-POSTED (P2) |
| F004 Lead sources | CLOSED | WEB_WORKSPACE | Public capture: CAPTURE-LIMIT (P2) |
| F005 Assignment | CLOSED | WEB_WORKSPACE | — |
| F006 Qualification | CLOSED | WEB_WORKSPACE | — |
| F007 Lifecycle | CLOSED | WEB_WORKSPACE | Allowed lifecycle cycle |
| F008 Duplicates | CLOSED | WEB_WORKSPACE | ABORTED-REQUEST (P3) |
| F009 Opportunities | **OPEN (P0 SALES-SCOPE)** | BLOCKED (native, MOBILE-V1) | Scope bypass through Sales |
| F010 Pipeline | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F011 Probability | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F012 Sales stages | CLOSED | WEB_WORKSPACE | — |
| F013 Calls | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F014 Meetings | CLOSED with P2 | BLOCKED (native, MOBILE-V1) | F014-CANCEL (P2) |
| F015 Tasks | CLOSED | BLOCKED (native, MOBILE-V1) | Automation: AUTOMATION-ACTIVITY (P2) |
| F016 Follow-ups | CLOSED | BLOCKED (native, MOBILE-V1) | Automation: AUTOMATION-ACTIVITY (P2) |
| F017 Notes/attachments | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F018 Email history | CLOSED | WEB_WORKSPACE | — |
| F019 Timeline | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F020 Territories/teams | CLOSED | WEB_WORKSPACE | — |
| F021 Import/export | CLOSED | WEB_WORKSPACE | — |
| F022 Conversion | CLOSED | WEB_WORKSPACE | — |
| F023 Quotation handoff | **OPEN (P0 SALES-SCOPE)** | WEB_WORKSPACE | No CRM scope check on `opportunityId` |
| F024 Pipeline dashboard | CLOSED | BLOCKED (native, MOBILE-V1) | — |
| F025 Sales forecast | CLOSED | WEB_WORKSPACE | — |
| F026 Won/lost reasons | CLOSED | WEB_WORKSPACE | — |
| F027 Lead scoring | CLOSED | WEB_WORKSPACE | — |
| F028 Custom fields/tags | CLOSED | WEB_WORKSPACE | CUSTOM-DATA debt |
| F029 Bulk actions | CLOSED | WEB_WORKSPACE | — |
| F030 CRM reports | CLOSED | WEB_WORKSPACE | Reports Journey 2 E2E: §11 |

Mobile dispositions come from `apps/mobile/src/modules/crm/ui/crm-feature-registry.ts`: 11 F-IDs are native (`native`, `native-read`, `native-action`) and are BLOCKED because their server API is missing; the other 19 open the web screen (WEB_WORKSPACE) and inherit the web status, though reaching them from the app still requires the missing mobile sign-in.

## 11. Verification

Run on Windows with Node 24.21.0 and pnpm 11.21.0 against the local PostgreSQL (no remote database). 31 of 32 steps green; the one red step is a known product defect, not a regression.

| Step | Result |
|---|---|
| `verify:toolchain`, `verify-field-security` | pass |
| CRM export guard / architecture rule tests / package boundary / SDK transport | 1/1, 21/21, 5/5, 3/3 |
| `test:api` | 1364 tests, 1361 pass, 0 fail (3 skipped) |
| `test:worker` / `test:sdk` / `test:mobile` / `test:web` | 76/76, 17/17, 2/2, 94/94 |
| `verify:architecture`, `verify-crm-module-contracts`, `verify-db-structure`, `verify:source-export` | pass |
| `verify:crm:backend` | 1013/1013 |
| `verify:route-security` | pass, 523 handlers (regenerates the stale matrix, §13) |
| `verify:routes`, `format:check`, `typecheck:web` | pass |
| `lint:web` | 0 errors, 1 warning (pre-existing, `features/hr/screens/PayrollScreens.tsx`, outside CRM) |
| `test:crm:db`, `test:shared-runtime:db`, `test:platform-services:db`, `test:access:db` | pass |
| `test:production:db` | 39/39 |
| CRM integration + tenant RLS security tests | 27/27 |
| CRM access matrix (DB) | 2/2 |
| `verify-crm-f007-live`, `verify-crm-f008-live` | pass |
| `verify-crm-f014-live` | **fail**: only `publicBookingCancelSynchronized: false`. This is F014-CANCEL (§8.5). The cancel SQL is byte-identical at the pre-programme baseline `0836aed8`, and the verifier was already red in the Prompt 7–10 runs, so the refactor did not cause it. |

Windows SWC remains blocked by host policy; Next.js builds and browser E2E run in Linux Docker only. Windows security settings were not changed.

### Linux Docker CRM E2E

Setup:
- disposable `node:24-bookworm` container (`crm-p11-e2e`);
- source copied from `git ls-files -co --exclude-standard`, hash-verified byte-identical with the working tree;
- temporary env copies with only the DB host rewritten to `host.docker.internal`; no credentials printed and no DB variables prepended;
- `pnpm install --frozen-lockfile`, Playwright Chromium;
- `CRM_E2E_PORT=3127 pnpm test:e2e:crm` (`playwright.config.crm.ts`, `next dev` web server).

**Main run: 26 passed, 1 failed, 3 did not run (20.7 min).**
- The failure is `crm-navigation.spec.ts:143` Journey 2 (REPORTS-BACK, §8.11).
- The 3 not run are the Journeys after it in the same serial spec.

The same 26/1/3 result was recorded at the pre-programme baseline.

Reruns (`--repeat-each=2` per test, each run also re-authenticates):

| Test | Main | Reruns | Verdict |
|---|---|---|---|
| `crm-authorization` ×3 | pass | 2/2 each | stable |
| `crm-completion` Journeys C, D, E, F | pass | 2/2 each | stable |
| `crm-mvp` Journeys A, B, C, D + restricted role | pass | 2/2 each | stable (earlier A/B/C flakes not reproduced) |
| `crm-navigation` Journey 1 (`:68`) | pass | 1/2, then 3/3 isolated | flaky. **Cause:** `OpportunityListScreen`'s mount effect `router.replace`s the URL from its filters, dropping `view=list` for `?offset=0`. The test passes only when it reads the URL before that replace. Pre-existing (identical at `0836aed8`). P3 (URL loses `view=list`; harmless because list is the default view) + TEST flake. |
| `crm-navigation` Journey 2 (`:143`) | fail | 0/2 | deterministic, REPORTS-BACK (P3, pre-existing) |
| `crm-navigation` `:203`, `:243`, `:276` (skipped by serial mode in the main run) | — | 2/2 each | stable |
| `crm-public-booking` `:182` | pass | 2/2 | stable |
| `crm-public-booking` `:99` (real booking) | pass | 0/2, 0/1 isolated, then 1/1 and 3/3 | flaky, 5 of 8 runs pass. In failures the page shows "This booking link is not available — The request could not be completed": the link fetch failed with a message-less error. Probing the same API in the same window returned 200, no server error was logged (only Next's "destination stream closed early"), and rate-limit counters were far below their maxima. Root cause **not determined**; the failures clustered within one ~2.5 h window. TEST/DEV-ENV until reproduced. |
| `crm-regression` ×5 | pass | 2/2 each | stable |
| `opportunity-stage-transition` | pass | 2/2 | stable |

Not run here:
- `crm-settings-setup.spec.ts` (4 tests) and `crm-uiux.spec.ts` (5) are outside `playwright.config.crm.ts`. They run in CI through the default config (`.github/workflows/erp-e2e.yml`).
- Real calendar-provider smoke tests have no credentials (unchanged since F014 closure).

Security verification is covered by the passing net:
- tenant RLS and tenant-isolation security tests;
- CRM access matrix on the restricted runtime role;
- route-security classification of all 523 handlers;
- field-security validator;
- `crm-authorization` E2E.

The SALES-SCOPE P0 is **not** detected by any existing test. That is a coverage gap, recorded here rather than closed, because this audit adds no product tests that would fail on HEAD.

## 12. Constitution compliance (`docs/01-standards/PROJECT_STRUCTURE_CONSTITUTION.md`)

| Clause | Result |
|---|---|
| `apps/web/src` contains only `app`, `core`, `features`, `shell`, `shared` | Compliant (`verify:architecture`) |
| F-IDs are not source directories | Compliant |
| Module owns its data model; others use its public contract | **Violated (ARCH-DEBT):** Sales reads `crm_opportunities`/`crm_opportunity_items`; Support writes `crm_customer_service_events`; CRM merge writes Sales/POS rows; Customer 360 reads Sales/Accounting; orchestration imports a CRM private file (§7, §3.5) |
| Multi-module coordination in `orchestration` | **Partly violated:** merge cross-module repointing lives in CRM (§7.3) |
| Route handlers thin, no SQL | Compliant (0 of 177 CRM routes) |
| Shared packages hold no module shortcuts | Compliant for CRM |
| Mobile and web consume the same server truth | **Violated (P1 MOBILE-V1)** |

## 13. Current-documentation corrections made by this audit

- `services/api/src/modules/crm/data-management/README.md`: the boundary paragraph now names the one orchestration file that bypasses `index.js`.
- `CRM_MOBILE_CAPABILITY_MATRIX.md` and `CRM_F001_F030_COMPLETION_MATRIX.md`: status banner pointing to this audit (mobile server API missing; F009/F023 reopened).
- `docs/frontend-rebuild/ROUTE_SECURITY_MATRIX.csv`: regenerated by `verify:route-security`. The tracked copy still listed 54 handlers removed by the ERP scope prune (POS and others) and lacked 3 Support handlers.
