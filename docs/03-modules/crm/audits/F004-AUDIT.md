# F004 Lead sources — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `lead-source-operations.js` in full (305 lines) and the `lead-sources` API routes.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | full CRUD + governed activate/deactivate; capture path (`lead-acquisition.js`, confirmed in F001's audit) maps external sources onto these records. |
| CAP-002 (**original vs latest source**, campaign/referral details, immutable provenance, inactive-source behavior, mapping) | **PARTIAL — 1 genuine gap.** Immutable provenance holds (`crm_leads.source_id` is a stable FK; sources are deactivated, never deleted, so historic attribution survives — confirmed via `crm_leads_source_id_organization_fkey` and the `(organization_id, source_id, ...)` index in `074_f001_lead_bulk_scale.sql:62`). Inactive-source behavior is correct (`setCrmLeadSourceActive` clears `is_default` on deactivation, keeps the row). **But there is only a single `crm_leads.source_id` column — no separate "original/first source" vs "latest/current source" tracking.** If a lead's source is ever changed after creation, the original acquisition channel is lost for attribution reporting, contradicting the dossier's explicit "original versus latest source" requirement. No campaign/referral-detail fields (e.g. `campaign_id`, `referrer`) were found on `crm_lead_sources` either. |
| FR-001/002/003 | PASS | CRUD with validation/permission/conflict states (`CRM_LEAD_SOURCE_*` codes); pagination in `listCrmLeadSources` (limit/offset capped at 100). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001 (`ACTIVE -> INACTIVE`, immutable historic attribution) | PASS | `setCrmLeadSourceActive` correctly supports **both** directions (unlike F003's Contacts one-way archive) — `active` param toggles either way, clearing `is_default`/setting `archived_at` appropriately. This is the one CRM feature so far that gets bidirectional lifecycle right where a sibling feature (F003) got it wrong. |
| FLOW-002 | PASS | `persistenceError` maps `23505` (including the specific `active_default` constraint) and `23514`/`22P02` to stable codes. |
| BR-001/BR-002 | PASS | single mutation path; `code`/`status`/`isSystem` explicitly rejected as client-writable on both create and update ("governed field" errors). |
| DATA-001/002 | PASS for what exists | `crm_lead_sources`/`crm_leads` linkage is correct and durable; see CAP-002 gap above for what's missing (original-source lineage, campaign/referral fields). |
| VAL-001/002 | PASS (structural) | `normalizeLeadSourceInput`/`assertLeadSourceId` centralize validation; did not re-read `validation.js` line-by-line. |
| CALC-001 | N/A | no derived calculation applies to this feature beyond `lead_count` (computed on read, `lead-source-operations.js:70-73`). |
| UX-001/002/003 | PASS (by test evidence) | `crm-lead-sources-f004.test.mjs` exists both sides and passes. |
| SEC-001 | PASS | `requireCrmView` (read) + `PERMISSIONS.crmSettingsManage` (write) at the route layer. |
| SEC-002 | N/A (plausible) | Lead sources are configuration/reference data, not personal records — no sensitive field is evident, so "stricter than record visibility" may not apply here. Not the same situation as F003's Contacts. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| INT-001 | PASS | capture adapters map through the record via F001's `lead-acquisition.js`, already confirmed. |
| API-001/002 | PASS | same verified route pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class, same as F001-F003. |

## Net assessment

24 of 37 rows PASS, 1 genuine gap (no original-vs-current source lineage, no campaign/referral fields despite the dossier requiring them), 1 N/A row correctly identified as not applicable rather than force-fit. This feature otherwise correctly implements the bidirectional lifecycle that F003 (Contacts) got wrong — worth noting as a positive pattern to copy when fixing F003's reactivation gap.
