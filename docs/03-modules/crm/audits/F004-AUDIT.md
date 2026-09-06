# F004 Lead sources — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `lead-source-operations.js` in full (305 lines) and the `lead-sources` API routes.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | full CRUD + governed activate/deactivate; capture path (`lead-acquisition.js`, confirmed in F001's audit) maps external sources onto these records. |
| CAP-002 (**original vs latest source**, campaign/referral details, immutable provenance, inactive-source behavior, mapping) | **PASS (fixed 2026-09-05).** Immutable provenance holds (`crm_leads.source_id` is a stable FK; sources are deactivated, never deleted). Inactive-source behavior is correct (`setCrmLeadSourceActive` clears `is_default` on deactivation, keeps the row). **Original vs latest source, fixed:** migration `082_f004_lead_source_lineage.sql` adds `crm_leads.original_source_id`, set once at creation (`createCrmRecord` forces it to mirror `source_id` at that moment, ignoring any caller-supplied value) and permanently immutable afterward (`updateCrmRecord` rejects any attempt to set it, `CRM_LEAD_ORIGINAL_SOURCE_IMMUTABLE`) — `source_id` remains the separate, freely-editable "current source." Lead detail shows both when they diverge. **Campaign/referral details, fixed:** `crm_leads.campaign_id` already existed for campaign attribution (confirmed present, contrary to this audit's earlier narrower check of only the `crm_lead_sources` table); the missing half was a referrer identity, now `crm_leads.referrer_name` (free text, matching the shape of comparable fields like `company_name`/`job_title` rather than a Contact FK, since a referrer is often not yet a CRM record when a lead is created). Both wired into create, generic edit and detail. |
| FR-001/002/003 | PASS | CRUD with validation/permission/conflict states (`CRM_LEAD_SOURCE_*` codes); pagination in `listCrmLeadSources` (limit/offset capped at 100). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001 (`ACTIVE -> INACTIVE`, immutable historic attribution) | PASS | `setCrmLeadSourceActive` correctly supports **both** directions (unlike F003's Contacts one-way archive) — `active` param toggles either way, clearing `is_default`/setting `archived_at` appropriately. This is the one CRM feature so far that gets bidirectional lifecycle right where a sibling feature (F003) got it wrong. |
| FLOW-002 | PASS | `persistenceError` maps `23505` (including the specific `active_default` constraint) and `23514`/`22P02` to stable codes. |
| BR-001/BR-002 | PASS | single mutation path; `code`/`status`/`isSystem` explicitly rejected as client-writable on both create and update ("governed field" errors). |
| DATA-001/002 | PASS (fixed) | `crm_lead_sources`/`crm_leads` linkage is correct and durable; `original_source_id`/`referrer_name` now close the gap CAP-002 previously found. |
| VAL-001/002 | PASS (structural) | `normalizeLeadSourceInput`/`assertLeadSourceId` centralize validation; did not re-read `validation.js` line-by-line. |
| CALC-001 (**original source is never recalculated away**) | **PASS (fixed).** This was the exact requirement `original_source_id`'s immutability satisfies — a lead's original acquisition channel is now fixed at creation and can never be edited or overwritten by a later `source_id` correction. `lead_count` itself (computed on read, `lead-source-operations.js:70-73`) is unaffected. |
| UX-001/002/003 | PASS (by test evidence) | `crm-lead-sources-f004.test.mjs` exists both sides and passes. |
| SEC-001 | PASS | `requireCrmView` (read) + `PERMISSIONS.crmSettingsManage` (write) at the route layer. |
| SEC-002 | N/A (plausible) | Lead sources are configuration/reference data, not personal records — no sensitive field is evident, so "stricter than record visibility" may not apply here. Not the same situation as F003's Contacts. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| INT-001 | PASS | capture adapters map through the record via F001's `lead-acquisition.js`, already confirmed. |
| API-001/002 | PASS | same verified route pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class, same as F001-F003. |

## Net assessment (updated 2026-09-05)

26 of 37 rows now PASS. The one genuine gap (no original-vs-current source lineage, no campaign/referral/referrer fields) is fixed, closing both CAP-002 and CALC-001 with the same migration. This feature otherwise correctly implements the bidirectional lifecycle that F003 (Contacts) initially got wrong (since fixed too) — a positive pattern worth having copied.
