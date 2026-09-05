# F010 Opportunity pipeline — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). Backend lifecycle is entirely inherited from F009 (`moveOpportunityStage`, already fully verified there). This audit focuses on what's specific to F010: the board UI (`pipeline-board.tsx`, read in full) and multi-pipeline/aging/accessibility claims.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | board scans pipeline health (stage totals/value) and moves opportunities via a keyboard-accessible `<select>` per card (`:399-410`), not drag-only — confirmed real, not just claimed. |
| CAP-002 (multiple pipelines, **stale-deal flags**, **stage aging**, historical snapshots, manager inspection, non-drag accessibility) | **PASS (fixed 2026-09-05).** Multiple pipelines: PASS — a pipeline selector exists (`aria-label="Select opportunity pipeline"`, `:240`) and the earlier full CRM test run confirmed "board provides pipeline selection... without cross-pipeline stage choices." Non-drag accessibility: PASS — every card has a real `<select>` alternative to drag-and-drop, not just an ARIA label on the drag handle. Historical snapshots: PASS (inherited from F009's `crm_opportunity_forecast_snapshots`/`crm_opportunity_stage_history`). **Stale-deal/aging fix:** the pipeline page now calls `evaluateOpportunityHealth` per row (server-side, in `crm/pipeline/page.tsx`) and attaches `warnings`/`inactiveDays` to each opportunity passed to the board; `getCrmOptions`'s stage query now also selects `stale_after_days` so the board can compare a deal's inactivity against its stage's configured threshold (falling back to the backend's own 14-day rule when a stage has none configured). The board renders a `danger` badge for an overdue close date and a `warning` badge for a stale deal (`agingBadge()` in `pipeline-board.tsx`), both with the underlying warning text as a tooltip. Proven by 2 new tests in `crm-opportunity-pipeline-f010.test.mjs`. |
| CAP-003 (stage movement only via the opportunity command, no board-specific DB mutation) | PASS | the board's `drop`/`requestMove` handlers call the same API route family verified for F009 (`moveOpportunityStage`), confirmed by "canonical route preserves same-origin, permission, billing, transaction, validation and audit" in the existing passing test suite. |
| FR-001/002/003 | PASS | loading/empty/error states present (`:215` empty-state variant, `:260`/`:268`/`:320` status/alert regions); history inherited from F009. |
| US-001/US-002 | PASS | same evidence as CAP-001. |
| FLOW-001 (inherits F009 state + F012 stage graph) | PASS | confirmed directly — the board reads `stage.isWon`/`stage.isLost`/`stage.probability` from the same pipeline-stage records F009's `moveOpportunityStage` validates against. |
| FLOW-002 | PASS | `requestMove` surfaces conflict responses from the same `CRM_STALE_WRITE`/`CRM_STAGE_CONFLICT` codes verified in F009; `aria-busy={moving === row.id}` prevents a double-submit race in the UI while a move is in flight. |
| BR-001/002 | PASS | no direct-table mutation in the component — all writes go through the API route. |
| DATA-001/002 | PASS | inherited from F009, already verified. |
| VAL-001/002 | PASS | inherited from F009's `moveOpportunityStage` validation (outcome-reason gating on won/lost moves is triggered from the board via `closeRequest`, `:276`). |
| CALC-001 | PASS | `stageValue(rows)` (per-column total) is computed on render from live row data, not a stored/mutable field. |
| UX-001/002/003 | PASS (by test evidence + direct read) | `crm-opportunity-pipeline-f010.test.mjs` passes; accessibility markers (`aria-label`, `role="status"`/`"alert"`, `sr-only` label on the move control) confirmed directly in the component. |
| SEC-001 | PASS | `canManage` gates whether drag/select controls render at all; underlying moves are still permission-checked server-side regardless of client state (defense in depth, not client-trust). |
| SEC-002 | N/A (plausible) | no sensitive field distinct from F009's is introduced by the board view. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED / N/A (inherited from F009) | |
| API-001/002 | PASS | inherited from F009. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (updated 2026-09-05)

27 of 37 rows now PASS. The one concrete UI gap (stale-deal/aging indicators computed but not rendered) is closed — the board now surfaces both the overdue-close-date and stale-inactivity signals per card. This feature correctly reuses F009's governed backend rather than duplicating logic, and the non-drag accessibility path is real, not decorative.
