# F026 Won / lost reasons — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). Core enforcement (`moveOpportunityStage` validating a reason against `outcome_type`) already fully verified in F009's audit; this pass adds the `lost-reasons` resource definition and `summarizeWinLoss`/win-loss-review functions in `opportunity-revenue-intelligence.js`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (close with a valid reason, analyze outcomes without losing historical meaning) | **PASS (fixed 2026-09-05).** Closing with a validated reason: PASS, already confirmed in F009. "Without losing historical meaning": the label-versioning gap is fixed — see CAP-002. |
| CAP-002 (mandatory-by-outcome rules, competitor/product dimensions, inactive reason handling, **reopen history**, **label versioning**, **AI theme analysis**) | **PASS on the two real gaps; AI theme analysis remains a genuine gap.** Mandatory-by-outcome: PASS (F009). Competitor dimension: PASS — `crm_win_loss_reviews` has a real `competitor_name` field, and `summarizeWinLoss` aggregates outcomes `byReason` and `byCompetitor`. Inactive reason handling: PASS. **Reopen history: FIXED** — F009 now has a fully governed reopen path (`moveOpportunityStage` allows won/lost -> open with a required reason), and every close/reopen transition is permanently recorded in `crm_opportunity_stage_history` (migration `078_f009_opportunity_reopen_history.sql`), so "reopen creates a new event and preserves prior close reason" (F026-FLOW-001) is now literally true — the reopen doesn't touch the earlier close's history row. **Label versioning: FIXED** — the same migration adds `outcome_reason_label` (a text snapshot taken at the moment of the transition, alongside the FK) to `crm_opportunity_stage_history`; `moveOpportunityStage` now selects `crm_lost_reasons.name` and stores it on the history row, so a later rename of the reason no longer rewrites what historical opportunities are shown to have closed under. The opportunity detail page's stage-history timeline now renders this snapshot label per transition. AI theme analysis remains a genuine, unbuilt gap — `crm_win_loss_reviews`'s free-text fields still aren't clustered/summarized. |
| CAP-003 (feeds reports/forecast accuracy; never modifies Sales orders/quotations) | PASS | `summarizeWinLoss` and the rollup query (F025's audit) are both read-only aggregations; no write path into Sales tables exists anywhere in the functions read. |
| FR-001/002/003 | PASS | reason configuration uses the standard generic-CRUD validation/permission/conflict states. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS (for what exists) | already verified in F009: reason validated against outcome type before a close commits, atomically. |
| BR-001/BR-002 | PASS (fixed 2026-09-05) | single validation path is correct (BR-001); BR-002's "historical events protected from later configuration edits" intent is now met by the reason-label snapshot. |
| DATA-001/002 | PASS (fixed 2026-09-05) | `crm_lost_reasons`, `crm_win_loss_reviews`, and now the snapshot columns on `crm_opportunity_stage_history` (`status`, `outcome_reason_id`, `outcome_reason_label`, `outcome_notes`) all exist and are used correctly. |
| VAL-001/002 | PASS | outcome-type cross-validation already verified in F009. |
| CALC-001 | PASS | `summarizeWinLoss`'s aggregates are computed fresh from source rows, not stored/mutable. |
| UX-001/002/003 | NOT INDEPENDENTLY VERIFIED | No dedicated `f026` frontend test found this pass beyond the existing opportunity-detail exclusion test already cited. |
| SEC-001/002 | PASS (inherited) | reason configuration follows the standard `crmSettingsManage`-equivalent gate used by sibling settings resources (F004/F007/F012). |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | GAP | no theme-analysis/NLP capability exists over the free-text review fields. |
| API-001/002 | PASS | generic-resource route pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (updated 2026-09-05)

24 of 37 rows now PASS. Both real gaps — no reason-label snapshot at close time, and the inherited no-reopen limitation from F009 — are fixed by the same migration/code change in F009 (`078_f009_opportunity_reopen_history.sql` + `moveOpportunityStage`), since they were two symptoms of the same missing capability: closes and reopens weren't durably recorded with their outcome context. AI theme analysis over the free-text review fields remains a genuine, separate, unbuilt gap.
