# F002 Accounts / companies — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `account-operations.js` (full, 549 lines), `account-intelligence.js` (hierarchy/merge functions, ~450 of 1,450 lines), the `accounts` API routes, and `057_f002_crm_accounts.sql`/`016_crm_account_contact_foundation.sql`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | `account-operations.js` (360/CRUD), `account-intelligence.js` (hierarchy, merge) cover the stated outcome; cross-module consumption goes through `getCrmAccount`/public contract. |
| CAP-002 (hierarchy cycles/merge survivorship/legal identifiers/sensitive visibility) | PASS | `setAccountParent` (`account-intelligence.js:152-223`) uses a recursive CTE to reject cycles before writing; `repointReferences` (`:254-292`) dynamically discovers every FK into `business_parties` via `pg_constraint` and repoints them on merge, with duplicate-conflict detection; `gstin`/`pan` are first-class columns. |
| FR-001/002/003 | PASS | full CRUD with validation/permission/conflict paths; `listCrmAccounts` paginates (`limit`/`offset`, capped at 100); history via `crm_account_hierarchy_events`/`crm_account_merge_history`. |
| US-001/US-002 | PASS | same evidence as CAP-001/FR-002. |
| FLOW-001 (`PROSPECT -> ACTIVE -> INACTIVE/ARCHIVED; MERGED via history`) | **PARTIAL — dossier conflates two separate columns.** There is no `PROSPECT` lifecycle status; `prospect` is a `party_type` value (customer/both/prospect), orthogonal to `status` (active/inactive only, set by `archiveCrmAccount`). The "MERGED via history" half of the sentence is accurate. Less severe than F001's mismatch but still needs the dossier corrected to describe `party_type` and `status` as two axes. |
| FLOW-002 | PASS | `persistenceError` maps `23505`/`23503`/`23514` to stable conflict/validation codes; merge repointing surfaces `CRM_MERGE_RELATIONSHIP_CONFLICT` rather than partially applying. |
| BR-001/BR-002 | PASS | all mutation goes through this file; hierarchy/merge events are insert-only audit trails. |
| DATA-001/002 | PASS | `business_parties`, `contacts`, `crm_account_hierarchy_events`, `crm_account_merge_history` all exist and are referenced exactly as the dossier states. |
| VAL-001/002 | PASS (by structure, not independently re-derived) | `throwValidation`/`normalizeAccountInput`/`validateAccountInput` centralize validation with `CRM_ACCOUNT_*` codes; did not re-read `record-validation.js` line-by-line this pass. |
| CALC-001 | PASS | relationship counts (`relationshipCounts` query, `account-operations.js:284-291`) are computed on read, not stored/mutable. |
| UX-001/002/003 | PASS (by test evidence) | `crm-accounts-f002.test.mjs` (both apps/web and services/api) exist and pass; did not personally re-verify every breakpoint. |
| SEC-001 | PASS | `requireCrmView` (baseline) + `PERMISSIONS.partiesManage` (write) enforced at the route layer (`apps/web/src/app/api/crm/accounts/route.ts:46,81`); `accountScope`/`assertWritableScope` enforce company scope in the domain layer. No owner/branch scoping exists, but this is a **deliberate, documented design choice**: `createCrmAccount`/`updateCrmAccount` explicitly reject a supplied `ownerUserId` ("Account ownership is not available in the canonical Account model") — Accounts are company-shared records by design, not individually owned like Leads, so "owner scope where applicable" correctly does not apply here. |
| SEC-002 | NOT INDEPENDENTLY VERIFIED | Did not locate a specific sensitive-field-redaction path analogous to `lead-security.js` for Accounts this pass — GSTIN/PAN are returned in full to anyone with `partiesManage`/view access; whether that's correct depends on whether the dossier considers those "sensitive" (plausible for PAN). Needs a follow-up check, not assumed passing. |
| AUTO-001 / APP-001 / NOTIF-001 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| REP-001 | NOT INDEPENDENTLY VERIFIED | Did not check for an Accounts-specific report/KPI definition this pass. |
| AI-001 (`AI_ASSIST`) | NOT INDEPENDENTLY VERIFIED | `account-intelligence.js` exists but I did not confirm an AI-generation path specifically (as opposed to deterministic merge/hierarchy logic, which is not itself "AI"). |
| INT-001/002 | PASS (INT-001 boundary) / NOT INDEPENDENTLY VERIFIED (INT-002 reconciliation) | Sales consumes accounts only via `getCrmAccount`-style reads per earlier Sales research this session; no direct cross-module table write found. |
| API-001/002 | PASS | route reads `assertSameOrigin`, `audit()`, `tenantTransaction`, permission checks directly in the files read this pass. |
| PERF-001 | GAP | No load/perf test exists. |
| OBS-001 | PARTIAL | `queueOutboxEvent`/`audit()` present on every mutation; no Accounts-specific metrics/dead-letter evidence found. |
| E2E-001/002 | GAP | No live browser E2E run this session. |
| UAT-001/002 | GAP | No human UAT performed. |

## Net assessment

24 of 37 rows PASS with cited evidence, 1 PARTIAL (dossier lifecycle text needs correcting, smaller than F001's), 6 not independently traced this pass (SEC-002, AUTO-001, APP-001, NOTIF-001, REP-001, AI-001, INT-002), 4 are the same standing gap class as F001 (PERF-001, E2E, UAT — genuinely untested/unperformed across the whole module, not specific to F002).

The merge/hierarchy engineering (`setAccountParent`, `repointReferences`) is the most sophisticated code read in this feature and holds up well under scrutiny — cycle-safe, conflict-safe, audited.
