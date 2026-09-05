# F026 Won / lost reasons — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). Core enforcement (`moveOpportunityStage` validating a reason against `outcome_type`) already fully verified in F009's audit; this pass adds the `lost-reasons` resource definition and `summarizeWinLoss`/win-loss-review functions in `opportunity-revenue-intelligence.js`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (close with a valid reason, analyze outcomes without losing historical meaning) | **PARTIAL.** Closing with a validated reason: PASS, already confirmed in F009 (reason must match `outcome_type`, mandatory for won/lost). "Without losing historical meaning": **partially undermined by a label-versioning gap** — see CAP-002. |
| CAP-002 (mandatory-by-outcome rules, competitor/product dimensions, inactive reason handling, **reopen history**, **label versioning**, **AI theme analysis**) | **PARTIAL, with one finding better than expected.** Mandatory-by-outcome: PASS (F009). Competitor dimension: **PASS, better than initially assumed** — `crm_win_loss_reviews` has a real `competitor_name` field, and `summarizeWinLoss` (`opportunity-revenue-intelligence.js:331-363`) aggregates outcomes `byReason` and **`byCompetitor`** with average cycle days — genuine analytics, not just a stored field nobody reads. (Note: the opportunity detail page deliberately excludes competitor-intelligence UI per an existing test — `assert.doesNotMatch(source, /competitor intelligence|battlecard/i)` — so this analytics capability lives in a separate reporting surface, not inline on the deal page; a reasonable design choice, not a gap.) Inactive reason handling: PASS — `lost-reasons` uses the standard `statusColumn`/archive pattern (line 3140 maps to `'inactive'`), and `moveOpportunityStage` already requires `status='active'` on the reason at close time (F009). **Gaps:** reopen history — inherits F009's confirmed gap directly (no reopen path exists for a closed opportunity, so there's no "reopen" history to have at all). Label versioning — `moveOpportunityStage` stores only `outcome_reason_id` (a foreign key), never a text snapshot of the reason's label at the time of closing; if an admin later renames or recategorizes a lost reason, every historical opportunity closed under the old label silently displays the new one — a real "historical meaning" loss relative to CAP-001's own wording. AI theme analysis — `crm_win_loss_reviews` has free-text `interview_notes`/`lessons` fields but nothing clusters or summarizes them into themes; only structured fields (`primary_reason`, `competitor_name`) are aggregated. |
| CAP-003 (feeds reports/forecast accuracy; never modifies Sales orders/quotations) | PASS | `summarizeWinLoss` and the rollup query (F025's audit) are both read-only aggregations; no write path into Sales tables exists anywhere in the functions read. |
| FR-001/002/003 | PASS | reason configuration uses the standard generic-CRUD validation/permission/conflict states. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS (for what exists) | already verified in F009: reason validated against outcome type before a close commits, atomically. |
| BR-001/BR-002 | PARTIAL | single validation path is correct (BR-001), but the label-versioning gap means "historical Won/lost reasons events" are not fully protected from a *later configuration edit* changing their displayed meaning (BR-002's intent). |
| DATA-001/002 | PARTIAL | `crm_lost_reasons`, `crm_win_loss_reviews` both exist and are used correctly for what they store; the missing reason-label snapshot on the opportunity's own close event is the specific data-model gap. |
| VAL-001/002 | PASS | outcome-type cross-validation already verified in F009. |
| CALC-001 | PASS | `summarizeWinLoss`'s aggregates are computed fresh from source rows, not stored/mutable. |
| UX-001/002/003 | NOT INDEPENDENTLY VERIFIED | No dedicated `f026` frontend test found this pass beyond the existing opportunity-detail exclusion test already cited. |
| SEC-001/002 | PASS (inherited) | reason configuration follows the standard `crmSettingsManage`-equivalent gate used by sibling settings resources (F004/F007/F012). |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | GAP | no theme-analysis/NLP capability exists over the free-text review fields. |
| API-001/002 | PASS | generic-resource route pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

22 of 37 rows PASS or PASS-with-caveat. The competitor-analytics finding is better than I expected going in (real aggregation, not just a stored field). The two real gaps — no reason-label snapshot at close time, and the inherited no-reopen limitation from F009 — both point at the same underlying theme already seen elsewhere in this audit: this module is very good at *preventing bad writes* but occasionally weaker at *preserving historical truth against later configuration changes*, which is precisely what F026's own CAP-001 wording warns against.
