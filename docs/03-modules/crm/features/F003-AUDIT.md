# F003 Contacts — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `contact-operations.js` in full (457 lines) and the `contacts` API routes.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | full CRUD scoped through the linked account; `validateAccountRelationship` blocks linking to an archived account. |
| CAP-002 (multiple relationship roles/consent/preferred language/stakeholder role/merge survivorship/**sensitive-email visibility**) | **PARTIAL — 2 genuine gaps, not documentation drift.** Merge survivorship exists (`mergeContactsGoverned` in `account-intelligence.js:556`, uses the same generic FK-repointing engine verified for F002). But: (1) **no sensitive-email/phone redaction exists for Contacts** — unlike Leads' `projectLeadForContext`/`LEAD_SENSITIVE_PERMISSION`, any user who passes the baseline `requireCrmView` gate sees full email/phone/mobile for every contact in scope; there is no stricter-than-record-visibility field gate. (2) No preferred-language/timezone/stakeholder-role fields found in `CONTACT_FIELDS` or the migration. |
| FR-001/002/003 | PASS | CRUD with validation/permission/conflict states; `listCrmContacts` paginates (limit/offset capped at 100). |
| US-001/US-002 | PASS | same evidence as CAP-001. |
| FLOW-001 (`ACTIVE <-> INACTIVE -> ARCHIVED`) | **GAP, not just stale text.** The dossier explicitly requires a **bidirectional** `ACTIVE <-> INACTIVE` transition. `archiveCrmContact` only goes one direction (active -> inactive); grepping the whole CRM module and its tests found **no reactivation path at all** — no `reactivateContact`, no UI button, no test. A contact archived by mistake cannot currently be restored except by direct DB access. This is a real missing capability, not a wording issue. |
| FLOW-002 | PASS | `persistenceError` maps constraint violations to stable codes (`CRM_CONTACT_CONFLICT`, `CRM_CONTACT_ACCOUNT_NOT_FOUND`, etc.). |
| BR-001/BR-002 | PASS | single mutation path; no update path found for historical events. |
| DATA-001/002 | PASS | `contacts`, `business_parties`, `crm_contact_merge_history`, `crm_activities`, `crm_communications` all exist and are used as stated. |
| VAL-001/002 | PASS (structural) | `throwValidation`/`normalizeContactInput`/`validateContactInput` centralize this; did not re-read `record-validation.js` line-by-line. |
| CALC-001 | PASS | `relationships` counts computed on read (`contact-operations.js:264-271`), not stored. |
| UX-001/002/003 | PASS (by test evidence) | `crm-contacts-f003.test.mjs` exists both sides and passes; not personally re-verified per breakpoint. |
| SEC-001 | PASS | `requireCrmView` + `PERMISSIONS.partiesManage` at the route layer; `contactScope`/`assertWritableScope` enforce company scope in the domain layer. No owner scope — consistent deliberate design (`assertGovernedFields` explicitly rejects `ownerUserId`), same rationale as F002. |
| SEC-002 (sensitive fields, negative tests) | **GAP.** Same finding as CAP-002 above — there is no field-level sensitivity gate for contact email/phone at all, so there is nothing for a negative test to prove. This is the row that should have caught the CAP-002 gap. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | NOT INDEPENDENTLY VERIFIED | No AI-generation path found for Contacts specifically in the files read. |
| INT-001/002 | PASS (INT-001) / NOT INDEPENDENTLY VERIFIED (INT-002) | Contacts are read through `getCrmContact`/public functions by Opportunities/Activities; no direct foreign-table writes found in files read. |
| API-001/002 | PASS | same route-layer pattern verified for F001/F002 (`assertSameOrigin`, `audit()`, `tenantTransaction`, permission checks). |
| PERF-001 | GAP | no load test. |
| OBS-001 | PARTIAL | `queueOutboxEvent`/audit present; no Contacts-specific metrics found. |
| E2E-001/002 | GAP | no live browser E2E this session. |
| UAT-001/002 | GAP | no human UAT performed. |

## Net assessment

This feature has **two real, actionable gaps**, not just stale wording: (1) no way to reactivate an archived contact despite the dossier requiring bidirectional status transitions, and (2) no sensitive-field redaction for contact email/phone despite the dossier explicitly calling out "sensitive-email visibility" as required enterprise scope and SEC-002 requiring it. 20 of 37 rows PASS with cited evidence; 2 rows are genuine gaps; the rest follow the same not-independently-traced / standing-PERF-E2E-UAT pattern as F001/F002.

These two gaps are cheap to close (mirror `lead-security.js`'s pattern for the email/phone redaction; add a `reactivateCrmContact` mirroring `archiveCrmContact`) but are being recorded here rather than silently fixed, since the instruction for this pass is to trace and report, not to implement — implementation should happen as a deliberate follow-up with its own test.
