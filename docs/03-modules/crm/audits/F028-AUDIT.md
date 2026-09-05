# F028 Custom fields and tags — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading the `custom-field-definitions` resource schema (`index.js:1149-1168`) and searching for formula/expression evaluation and field-level role visibility.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | typed custom fields (`data_type`, `options`, `validation`, `unique_value`) are real and configurable; used in lead validation (confirmed in F005's audit of `validateLeadInput`, which reads `crm_lead_field_definitions` and applies type-specific checks — email/url/number/picklist). |
| CAP-002 (field lifecycle, **role visibility**, **dependent options**, search/indexing, migration, API exposure, **required-field rollout**, executable-expression prohibition) | **PARTIAL — role visibility fixed 2026-09-05, 2 gaps remain.** Search/indexing: PASS. Field lifecycle: PASS. Executable-expression prohibition: PASS by absence. **Fixed:** `crm_custom_field_definitions.visible_to_roles` (migration `076_f028_custom_field_role_visibility.sql`) restricts a field to specific role slugs; `projectCrmRecord`/`projectCrmRecords` redact restricted keys from a `custom-records` row's `data` blob for a caller whose role isn't allowlisted (single reads, and list reads batched into one query rather than N+1); `validateCustomRecord` symmetrically blocks *setting* a restricted field the caller can't see, checked only against fields the caller actually supplied — not the full merged before+after blob, so editing an unrelated field on a record that happens to already have a restricted field set is never blocked. 8 new regression tests in `crm-custom-fields-f028.test.mjs`. **Still missing:** no dependent-options support; no required-field-rollout safeguard. |
| CAP-003 (exposed through governed metadata/API/reports only when field permissions allow) | **PASS (fixed).** Field permissions now exist and are enforced on both read and write. |
| FR-001/002/003 | PASS | standard generic-resource validation/permission/conflict states. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | standard config-resource pattern (create/update/archive), no domain-specific transition needed for this feature. |
| BR-001/BR-002 | PASS | single definition-management path; no update-in-place of a field's recorded historical values when the definition changes (values are stored per-record independently of the definition). |
| DATA-001/002 | PASS | `crm_custom_field_definitions`, `crm_tags` both exist and are used as described. |
| VAL-001/002 | PASS (structural) | type/uniqueness/required validated via the shared `validateLeadInput` path already confirmed in F005. |
| CALC-001 | N/A | no calculation (and deliberately no formula capability, per CAP-002 finding). |
| UX-001/002/003 | PASS (by test evidence) | "F028 tags and custom fields are editable on lead detail and remain governed/audited" confirmed passing in this session's earlier full CRM test run. |
| SEC-001/002 | PASS (fixed) | record-level scope plus the new field-level sensitivity gate, same pattern as F003's Contacts fix. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | generic-resource route pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (updated 2026-09-05)

22 of 37 rows now PASS. Role visibility is fixed for the `custom-records`/`crm_custom_field_definitions` system with both read redaction and write blocking, batched to avoid N+1 queries on list reads. Remaining gaps (dependent-option picklists, required-field-rollout safety) are real scope additions, not safety issues.
