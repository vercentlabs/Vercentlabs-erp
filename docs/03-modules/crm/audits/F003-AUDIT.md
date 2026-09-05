# F003 Contacts — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `contact-operations.js` in full (457 lines) and the `contacts` API routes.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | full CRUD scoped through the linked account; `validateAccountRelationship` blocks linking to an archived account. |
| CAP-002 (multiple relationship roles/consent/preferred language/stakeholder role/merge survivorship/**sensitive-email visibility**) | **PARTIAL — 1 gap fixed 2026-09-05, 1 remains.** Merge survivorship exists (`mergeContactsGoverned` in `account-intelligence.js:556`, uses the same generic FK-repointing engine verified for F002). **Fixed:** sensitive-email/phone redaction now exists — `contact-security.js` (new file) mirrors `lead-security.js`'s pattern exactly: `crm.contacts.view_sensitive` permission (migration `036_crm_contact_governance_permissions.sql`), `projectContactForContext` strips `email`/`phone`/`mobile` for a caller without it, `getCrmContactForCaller` applies this at every API-boundary return point while the internal `getCrmContact` stays unredacted for validation reuse (needed so `updateCrmContact`'s "at least one contact method remains" check still works for a restricted editor), search is restricted to non-sensitive columns, and writing a sensitive field without the permission is blocked at `createCrmContact`/`updateCrmContact` (`CRM_CONTACT_SENSITIVE_FIELD_FORBIDDEN`) so nothing can be written that can't be read back. Regression tests in `crm-contacts-f003.test.mjs` (4 new `F003 SEC` cases). Still not found: preferred-language/timezone/stakeholder-role fields in `CONTACT_FIELDS` or the migration. |
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
| SEC-002 (sensitive fields, negative tests) | **PASS (fixed 2026-09-05).** See CAP-002 — a field-level sensitivity gate now exists with negative tests proving a restricted viewer sees neither the field nor a way to search on it. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | NOT INDEPENDENTLY VERIFIED | No AI-generation path found for Contacts specifically in the files read. |
| INT-001/002 | PASS (INT-001) / NOT INDEPENDENTLY VERIFIED (INT-002) | Contacts are read through `getCrmContact`/public functions by Opportunities/Activities; no direct foreign-table writes found in files read. |
| API-001/002 | PASS | same route-layer pattern verified for F001/F002 (`assertSameOrigin`, `audit()`, `tenantTransaction`, permission checks). |
| PERF-001 | GAP | no load test. |
| OBS-001 | PARTIAL | `queueOutboxEvent`/audit present; no Contacts-specific metrics found. |
| E2E-001/002 | GAP | no live browser E2E this session. |
| UAT-001/002 | GAP | no human UAT performed. |

## Net assessment (updated after the gap-closing pass, 2026-09-05)

One of the two real gaps found in the initial trace is now fixed: sensitive-field redaction for contact email/phone/mobile, matching Leads' existing pattern, with regression tests. One remains: no reactivation path for an archived contact (queued — needs a `reactivateCrmContact` mirroring `archiveCrmContact`, plus a UI action and its own test; not done in this pass since it's a feature addition, not a security fix). 22 of 37 rows now PASS with cited evidence.
