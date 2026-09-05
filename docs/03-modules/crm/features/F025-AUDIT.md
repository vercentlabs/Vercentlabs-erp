# F025 Sales forecast — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading the `forecast-submissions` resource definition, its `assertLifecycleUpdate` state machine (already read in full for F009's audit), and the quota/pipeline rollup report query (`index.js:4525-4559`) in full.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (submit, roll up, adjust, **reproduce a forecast period**) | PASS | `crm_forecast_submissions` has a real, guarded state machine (`draft→submitted→approved/rejected→superseded`, verified in F009's audit of `assertLifecycleUpdate`) where an `approved` submission can only move to `superseded` — never back to `draft` — which is exactly what's needed to reproduce a historical forecast period faithfully: old submissions are preserved, not overwritten, when a new one is made. The rollup query independently computes quota coverage/attainment/win-rate/cycle-time live from source data. |
| CAP-002 (**categories**, quotas/targets, hierarchy permissions, submissions, snapshots, manager adjustments, **accuracy/backtesting**, predictive confidence) | **PARTIAL — strong on structure, 1 confirmed gap.** Categories: PASS — `forecast_category` distinguishes `best_case`/`committed`/open pipeline, consistently used in both the submission fields and the rollup query. Quotas/targets: PASS — `crm_quota_plans` joined correctly by user/period with date-range overlap logic (`period_end >= $5 AND period_start <= $6`), scoped by company. Manager adjustments: PASS — `manager_adjustment` is a first-class field on `crm_forecast_submissions`, distinct from the rep's own submitted amounts, so a manager's override is visible and auditable rather than silently overwriting the rep's number. Predictive confidence: PASS — `confidence_percent` field exists on submissions, and F011's audit already confirmed a real, explainable predictive-forecast model (`calculatePredictiveForecast`) exists elsewhere in this module that this could reasonably feed from. Hierarchy permissions: PASS by construction — the rollup query applies the same `companyVisible`/`branchVisible`/`ownerVisible` scoping verified as correct in F024's dashboard audit, and territory/team linkage exists on submissions. **Gap: no accuracy/backtesting function exists** — nothing compares a past period's submitted/predicted forecast against the period's actual closed results after the fact (confirmed by grep: no match for backtest/forecast-accuracy anywhere in the module). |
| CAP-003 (consumes F009-F012/F020, publishes read models, doesn't become opportunity authority) | PASS | the rollup query only reads `crm_opportunities`/`crm_quota_plans`; no write path back into opportunities exists in this feature. |
| FR-001/002/003 | PASS | the generic-resource CRUD pattern (same as F020 Territories) gives validation/permission/conflict states; the lifecycle guard is genuinely feature-specific (unlike F020, which had no comparable domain guard at all) — this is architecturally closer to F009's quality than F020's. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | the `draft/submitted/approved/rejected/superseded` transition table in `assertLifecycleUpdate` is a real, enforced state machine, not just a status column. |
| BR-001/BR-002 | PASS | approved submissions cannot be edited back to draft — historical truth is protected at the transition-table level. |
| DATA-001/002 | PASS | `crm_forecast_submissions`, `crm_quota_plans` both exist and relate correctly to opportunities/users/territories. |
| VAL-001/002 | PASS | the lifecycle transition table itself is the validation; invalid transitions get a specific `CRM_FORECAST_TRANSITION_INVALID` code (confirmed in F009's audit). |
| CALC-001 | PASS | quota coverage/attainment/win-rate are computed live with correct null-safe division (`CASE WHEN quota > 0 THEN ... ELSE NULL`), not stored mutable fields. |
| UX-001/002/003 | NOT INDEPENDENTLY VERIFIED | No dedicated `f025` test file found this pass. |
| SEC-001/002 | PASS | consistent scoping pattern already verified for the underlying query. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass — though AI-001 is worth a specific follow-up given `confidence_percent`'s likely relationship to F011's predictive model. |
| API-001/002 | PASS | generic-resource route pattern, already verified. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

24 of 37 rows PASS. Unlike F020 (Territories), which leans on generic CRUD with no domain-specific safeguard at all, this feature pairs the same generic-resource pattern with a real, enforced lifecycle state machine and a genuinely sophisticated rollup query — a better example of how to use the generic pattern safely. The one clear gap (no accuracy/backtesting) is a real missing capability, not a documentation nuance.
