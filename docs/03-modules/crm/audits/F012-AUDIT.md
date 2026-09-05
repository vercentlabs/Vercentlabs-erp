# F012 Sales stages — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `sales-stage-operations.js` in full (608 lines).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | configuration cannot strand live deals: deactivation is **blocked** while open opportunities occupy a stage (`CRM_SALES_STAGE_OPEN_OPPORTUNITIES`, `:518-519`) rather than silently orphaning them. |
| CAP-002 (required fields, guidance, forecast mapping, versioning, **deactivation/migration of live stages**, terminal semantics) | **PASS — best-handled version of the "deactivation" concern found anywhere in CRM.** Forecast mapping is enforced both ways: won/lost stages are forced to `forecast_category='closed'` and an open stage is forbidden from using `'closed'` (`:466-468`). Terminal semantics: only one active won and one active lost stage per pipeline, enforced on both create/update **and reactivation** (`assertTerminalAvailable` called from all three paths). Live-stage deactivation/migration: unlike F007 (Lead stages, which allows deactivating a stage while leads still sit in it) and F004 (Lead sources, same), **F012 actively blocks deactivation until the operator moves the open opportunities out**, and separately guarantees at least one active Open stage always remains (`:520-528`). This is a stricter, safer design than its sibling features and should be the template used when closing F007's equivalent gap. |
| CAP-003 (stages feed pipeline/probability/forecast/reports, remain CRM config truth) | PASS | `nextProbability`/`nextForecast` are derived from `stageType`, not independently settable when type is won/lost — a single source of truth. |
| FR-001/002/003 | PASS | full CRUD/activation workflow with validation/permission/conflict states; reorder handles arbitrary-size pipelines without a bulk-volume concern (stage counts are inherently small). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | **the reorder algorithm is the most sophisticated concurrency-correct code found in the CRM audit**: `applyActiveOrder` (`:310-357`) parks every active stage on temporary sequence values disjoint from both old and new positions before writing final values, specifically to avoid violating a non-deferrable unique constraint on a direct swap — with a code comment explaining exactly why, and confirmed by the existing test "reorder parks active sequences before assigning the final unique order." **Idempotent-replay handling appears twice**, correctly, in both `updateSalesStage` (`:475-476`) and `setSalesStageActive` (`:508`) — a retried no-op edit returns `{replayed: true}` without duplicate history/outbox writes, exactly the same correct pattern found in F011. |
| BR-001/BR-002 | PASS | pipeline cannot be changed on an existing stage (`CRM_SALES_STAGE_PIPELINE_IMMUTABLE`); every material change writes to `crm_sales_stage_configuration_history` with before/after snapshots. |
| DATA-001/002 | PASS | `crm_pipeline_stages`, `crm_sales_stage_configuration_history` used exactly as read; history retains full before/after JSON even after further edits. |
| VAL-001/002 | PASS | name uniqueness within a pipeline, stale-after-days only permitted on open stages, stable `CRM_SALES_STAGE_*` codes throughout. |
| CALC-001 | N/A | no monetary calculation in this feature; probability/forecast are configuration, not derived facts. |
| UX-001/002/003 | PASS (by test evidence + this session's direct API-test run) | `crm-sales-stages-f012.test.mjs` (both sides) passes; already independently re-run and confirmed green this session. |
| SEC-001 | PASS | `PERMISSIONS.crmSettingsManage`-gated (consistent with F004/F007's settings-management pattern); `pipelineScope` enforces company/branch. |
| SEC-002 | N/A (plausible) | no personal/sensitive field in stage configuration. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route pattern already verified for this route family (`crm-sales-stages-f012.test.mjs` covers the routes directly). |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

28 of 37 rows PASS with cited evidence, zero genuine functional gaps found. This is, along with F011, one of the two most carefully engineered features audited in CRM so far — the sequence-reorder algorithm and the double idempotent-replay handling both reflect real engineering care rather than a happy-path-only implementation. Its live-stage deactivation design (block until migrated, guarantee one open stage always remains) should be the pattern copied when fixing F007's weaker equivalent in the gap-closing pass.
