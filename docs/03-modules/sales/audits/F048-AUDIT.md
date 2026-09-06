# F048 Backorders — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by grepping the entire codebase (case-insensitive) for "backorder": zero matches in any `.js`/`.sql` file — only in docs (dossiers, registers) and `apps/web/src/modules/sales/scope.ts` (a navigation resource-key list, not logic). Also read `docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md`, the canonical (if terse) cross-module contract spec for this whole area.

| ID | Verdict | Evidence |
|---|---|---|
| **CAP-001 (entire capability) — GAP, recorded, not fixed this pass. Same root cause as F046/F047.** | FAIL | There is no backorder entity anywhere — no table, no status column, no function. "Unfulfilled confirmed demand" is only implicitly visible as `remaining_to_fulfill` in `order-governance.js`'s health computation (verified F042) — a derived number in a dashboard read, not a schedulable, trackable object with its own promise date, priority, or lineage as the dossier requires. |
| FLOW-001 (OPEN -> PARTIALLY_ALLOCATED -> ALLOCATED/FULFILLED/CANCELLED) | FAIL | No such state machine exists; nothing holds one of these states for unfulfilled demand. |
| CAP-002 (automatic/manual policy, promise date, priority, split shipments, cancellation, substitution, reallocation, communication) | N/A — moot until the base entity exists | Same reasoning as F045: refinements can't be meaningfully evaluated against a capability that doesn't exist. |
| Architectural context | Confirmed by design doc | `docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md`: *"Sales confirms demand and calls Stock availability/reservation contracts... Partial fulfilment/backorder, short pick, cancellation and retry/reversal are explicit."* This is the documented, intended architecture — backorders are supposed to fall out of the same Sales-to-Stock integration that F045 (availability) and F046 (reservation) are also missing. This is one unimplemented integration surfacing as three separate feature-level gaps, not three independent problems. |

## Net assessment (2026-09-06)

Confirms the pattern already established by F045/F046/F047: the entire Sales-to-Stock physical fulfilment contract described in `docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md` was never built. Backorder visibility is the natural downstream consequence of that same missing integration, not a separate gap requiring its own investigation — recommend the gap-closing pass treat F045/F046/F047/F048 as one Sales-to-Stock integration effort rather than four separate fixes.
