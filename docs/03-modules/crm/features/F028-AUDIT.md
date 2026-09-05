# F028 Custom fields and tags — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading the `custom-field-definitions` resource schema (`index.js:1149-1168`) and searching for formula/expression evaluation and field-level role visibility.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | typed custom fields (`data_type`, `options`, `validation`, `unique_value`) are real and configurable; used in lead validation (confirmed in F005's audit of `validateLeadInput`, which reads `crm_lead_field_definitions` and applies type-specific checks — email/url/number/picklist). |
| CAP-002 (field lifecycle, **role visibility**, **dependent options**, search/indexing, migration, API exposure, **required-field rollout**, executable-expression prohibition) | **PARTIAL — the security item is trivially satisfied by scope, 3 real gaps.** Search/indexing: PASS — an explicit `indexed` boolean column exists on the definition, so an admin can opt a field into search/indexing rather than it being all-or-nothing. Field lifecycle: PASS — standard `status` (active/inactive) column, consistent with the rest of the module's config-resource pattern. Executable-expression prohibition: **PASS by absence** — there is no formula/computed-field type or expression-evaluation code anywhere in the CRM module (confirmed by grep for `formula`/`expression`/`eval(`); custom fields are static typed values only, so there's no executable-expression surface to exploit in the first place. **Gaps:** no field-level role-visibility mechanism — the definition schema has no `visibleToRoles`/permission column, so once a custom field exists, anyone with ordinary record access sees it; no dependent-options support — `options` is a flat list with no way to make one field's choices depend on another's value; no required-field-rollout safeguard — marking an existing field `required=true` has no visible check for whether existing records already satisfy that requirement (no migration/backfill/validation-on-flip-to-required logic found). |
| CAP-003 (exposed through governed metadata/API/reports only when field permissions allow) | **Undermined by the role-visibility gap above** — since there's no field-level permission concept, "only when field permissions allow" has no permission dimension to enforce beyond ordinary record-level access. |
| FR-001/002/003 | PASS | standard generic-resource validation/permission/conflict states. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | standard config-resource pattern (create/update/archive), no domain-specific transition needed for this feature. |
| BR-001/BR-002 | PASS | single definition-management path; no update-in-place of a field's recorded historical values when the definition changes (values are stored per-record independently of the definition). |
| DATA-001/002 | PASS | `crm_custom_field_definitions`, `crm_tags` both exist and are used as described. |
| VAL-001/002 | PASS (structural) | type/uniqueness/required validated via the shared `validateLeadInput` path already confirmed in F005. |
| CALC-001 | N/A | no calculation (and deliberately no formula capability, per CAP-002 finding). |
| UX-001/002/003 | PASS (by test evidence) | "F028 tags and custom fields are editable on lead detail and remain governed/audited" confirmed passing in this session's earlier full CRM test run. |
| SEC-001/002 | PARTIAL | record-level scope is inherited correctly from the owning record (a lead's custom field is only visible if the lead itself is visible), but there is no additional field-level sensitivity gate — the same class of gap found in F003 (Contacts' missing sensitive-email redaction), just for admin-defined fields instead of built-in ones. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | generic-resource route pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

19 of 37 rows PASS or PASS-with-caveat. The security-sensitive item most people would worry about (executable custom-field expressions) is a non-issue because that capability was never built at all — a safe design choice, if a scope limitation. The real gaps (no field-level role visibility, no dependent-option picklists, no required-field-rollout safety check) are genuine and specific, not documentation drift.
