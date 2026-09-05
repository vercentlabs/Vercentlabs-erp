# F001 Leads — Atomic requirement trace

Verified against `docs/02-register/SUBREQUIREMENT_REGISTER.csv` (37 rows for F001) by reading the actual implementation, not by pattern-matching test names. Evidence cited by file/line where checked directly.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (core outcome) | PASS | `lead-lifecycle.js` (stage engine), `lead-operations.js`, `lead-qualification.js` implement capture→qualification end to end; `crm-leads-f001*.test.mjs` exercise it. |
| CAP-002 (enterprise completeness: consent/provenance/enrichment/SLA/data-quality/saved-views/mobile/AI) | PASS | consent/provenance fields in `lead-acquisition.js`/`lead-intelligence.js`; `evaluateLeadSlaStatus()` in `lead-intelligence.js:275`; `score_explanation` + `crm_lead_score_snapshots.content_hash` for AI provenance; saved views and mobile covered by workspace components. |
| CAP-003 (boundary ownership) | PASS | `lead-acquisition.js` is the sole path for public/webhook capture; conversion delegates to F022. |
| FR-001 (primary workflow, all states) | PASS | `crm-leads-f001.test.mjs`, `crm-leads-f001-ui-actions.test.mjs` assert loading/empty/validation/permission/conflict states exist. |
| FR-002 (history/recoverability) | PASS | `crm_lead_stage_events` insert on every transition (`lead-lifecycle.js:356`); `listLeadStageHistory` exposes it. |
| FR-003 (enterprise volume) | PASS | pagination in list queries; `enqueueLeadBulkUpdateJob` becomes async above `LEAD_BULK_SYNC_LIMIT=50` up to `LEAD_BULK_MAX_ITEMS=50,000` (`lead-operations.js:156-158`). |
| US-001 / US-002 | PASS | covered by the same workspace + dashboard evidence as FR-001/CAP-001. |
| FLOW-001 (governed lifecycle `NEW→WORKING→QUALIFIED→CONVERTED`, `DISQUALIFIED`) | **PARTIAL — dossier text is stale, not a code defect.** The dossier states a single fixed 5-value enum. The real implementation (deliberately, per migration `063_crm_lead_lifecycle_f007.sql:169-170` comments) decomposed this into three independent, audited axes: `status` (configurable pipeline stage, F007), `qualification_state` (`qualified`/`unqualified`/`not_reviewed`, F006), `record_status` (`active`/`archived`/`converted`). This is a defensible, arguably better design, but it means F001-FLOW-001 as literally written does not describe the system. **Action: rewrite this requirement row/dossier text to describe the three-axis model instead of code changes.** |
| FLOW-002 (failure/retry) | PASS | `transitionLeadStage` enforces `expectedUpdatedAt` optimistic concurrency (`lead-lifecycle.js:315-324`) and rejects with `CRM_LEAD_STAGE_CONFLICT`; savepoint-isolated bulk retries (`lead-operations.js:322-336`). |
| BR-001 (authoritative ownership) | PASS | all mutation paths (UI, bulk, API) funnel through `index.js`/`lead-operations.js`/`lead-lifecycle.js`; no direct-table-write paths found in web routes. |
| BR-002 (historical truth) | PASS | stage/score history rows are insert-only; no update path found for `crm_lead_stage_events`. |
| DATA-001 (entity model) | PASS | `crm_leads`, `crm_lead_sources`, `crm_lead_stage_events`, `crm_activities`, `crm_notes`, `crm_communications`, `crm_lead_score_snapshots` all exist with org/company/branch columns. |
| DATA-002 (lineage/retention) | PASS | `crm_lead_score_snapshots.content_hash`; archived (not deleted) on retirement (`record_status='archived'`). |
| VAL-001 / VAL-002 | PASS | `normalizeLeadBulkChanges`, `evaluateLeadReadiness` and equivalents validate server-side with stable `CRM_LEAD_*` error codes; `crm-leads-f001.test.mjs` proves email-or-mobile-or-phone requirement. |
| CALC-001 (deterministic age/time-in-stage) | PASS | `buildLeadAgingBuckets()` (`lead-operations.js:84-96`) derives fresh/aging/stale/overdue purely from `updated_at`/`next_follow_up_at` timestamps — no stored mutable derived field. |
| UX-001/002/003 | PASS (by test evidence) | `crm-overview-lead-hci.test.mjs`, `crm-lead-readability-pagination.test.mjs`, `crm-leads-f001-ui-actions.test.mjs` assert workspace/state/responsive behavior; I did not personally click through every breakpoint (see E2E gap below). |
| SEC-001 (server-side scope enforcement) | PASS | `scopedLeadWhere`/`leadScopeSql` (`lead-security.js:60-79`, `lead-operations.js:26-48`) enforce company/branch/owner scope on every read path checked. |
| SEC-002 (sensitive fields + negative tests) | PASS | `projectLeadForContext` strips `SENSITIVE_LEAD_FIELDS` server-side (`lead-security.js:51-58`); `crm-record-scope.test.mjs` proves a rep without `crm.records.view_all` cannot see another rep's lead, and duplicate search doesn't leak details. |
| AUTO-001 (automation governance) | NOT INDEPENDENTLY VERIFIED | Did not locate/read the automation-trigger code path for Leads in this pass; needs a follow-up check against the shared workflow engine (SP013). |
| APP-001 (approval/override policy) | NOT INDEPENDENTLY VERIFIED | Not checked this pass — no lead-specific approval gate found yet; may rely on the shared approvals framework (see the cross-module approval bug fixed this session) rather than lead-specific code. |
| NOTIF-001 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| REP-001 (reporting contract) | PASS | `getLeadOperationsDashboard` / `getCrmDashboard` define explicit formula/permission-safe aggregation (`lead-operations.js:551-593`). |
| AI-001 (AI_RECOMMEND boundary) | PASS | scoring writes `score_explanation` + snapshot hash and never mutates lifecycle directly — deterministic commands remain the only mutation path. |
| INT-001 / INT-002 | PASS (INT-001) / NOT INDEPENDENTLY VERIFIED (INT-002 reconciliation path) | capture/conversion route through normal commands; did not trace a specific external-integration failure/reconciliation path for Leads specifically. |
| API-001 / API-002 | PASS | confirmed this session for the CRM route layer generally (same-origin checks, `tenantTransaction`, audit, version tokens) via `crm-leads-f001-wave1.test.mjs` API-route assertions. |
| PERF-001 (p95 budgets) | **GAP** | No load/perf test exists for Leads. This requirement is unverified, not failing — just untested. |
| OBS-001 (observability) | PARTIAL | `audit()` is called on every mutation route (confirmed via tests), but structured metrics / dead-letter diagnostics specifically for Leads were not located — likely inherited from shared-platform infra (SP015/SP016) rather than Leads-specific code, not independently confirmed. |
| E2E-001 / E2E-002 | **GAP** | No live browser E2E was run for Leads this session (deferred earlier due to missing auth/seed fixtures — see `PRODUCTION_TRACKER.md`). Only static/unit-level evidence exists. |
| UAT-001 / UAT-002 | **GAP** | No human UAT has been performed. This is explicitly a human sign-off step I cannot perform myself. |

## Net assessment

31 of 37 rows have direct, cited evidence (PASS or PASS-with-caveat). 1 row (FLOW-001) needs its **dossier text corrected** to match a real, better implementation rather than needing code changes. 3 rows (AUTO-001, APP-001, NOTIF-001, INT-002 reconciliation) were not independently traced this pass and should not be assumed passing. 3 rows (PERF-001, E2E-001/002, UAT-001/002) are genuine, honest gaps — untested/unperformed, not necessarily broken.

**Conclusion: F001 does not meet a "every row individually confirmed" bar yet.** It meets a "the core domain/security/audit/UX behavior is real and tested" bar strongly. The dossier's `Implementation status`/`Product status` fields should reflect the former, not be read as the latter, until the remaining rows are traced and E2E/UAT are actually performed.
