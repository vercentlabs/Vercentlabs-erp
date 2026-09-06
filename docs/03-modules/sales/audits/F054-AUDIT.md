# F054 Customer returns — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by re-reading `createSalesReturnRequest` in full (`services/api/src/modules/sales/order-governance.js:1052-1174`, already read for F042) and confirming, via a full-repo grep for `UPDATE tenant.sales_return_requests`, that no function anywhere ever changes a return request's status after creation.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (authorize and track against delivered lines) | PASS, at the request-creation level | `createSalesReturnRequest` only accepts `confirmed`/`on_hold`/`closed` orders, requires an idempotency key and a reason, and validates each returned quantity against `fulfilled_quantity - already_returned_quantity` (verified F042) — genuinely correct validation against what was actually delivered, not just what was ordered. |
| **CAP-001 (the rest of the lifecycle) — GAP, recorded, not fixed this pass. Same "request created, never consumed" pattern as F045-F049.** | FAIL | Grepped the entire repository for `UPDATE tenant.sales_return_requests`: zero matches. A return request is created in `pending` status and then has no path anywhere to ever become `approved`, `rejected`, `received`, or `resolved`. There is no restocking (a real Stock receipt via `postStockMovement`), no refund, no exchange, and no credit-note creation triggered by a return — the entire decision-and-resolution half of the feature doesn't exist. |
| FLOW-001 (REQUESTED -> APPROVED -> IN_TRANSIT/RECEIVED -> RESOLVED or REJECTED/CANCELLED) | FAIL | Only the initial `REQUESTED` state is ever reached; none of the others have any code path. |
| CAP-002 (return windows, serial/lot constraints, disposition, nonreturnable items, restocking, exchange/refund) | N/A — moot given the lifecycle stops at request creation | Same reasoning as F045/F048/F049: refinements can't be meaningfully evaluated against a capability that never resolves. |
| FLOW-002 (idempotency) | PASS | Already verified for F042: caller-supplied idempotency key, returns the existing request unchanged on replay. |
| Cross-reference | Related but distinct from F045-F049 | This isn't the *same* missing Sales-to-Stock integration as F045-F049 (those are about outbound fulfilment; this is about inbound returns), but it's the identical *shape* of gap — a well-validated request-creation function with nothing downstream to act on it. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

Request creation is well-built (correct quantity validation against delivered/already-returned amounts, idempotent), but the entire approval/resolution/restocking/refund lifecycle is absent — a return, once requested, can never be resolved by any existing code path. Recorded for the gap-closing pass as its own item, distinct from (but structurally similar to) the F045-F049 Sales-to-Stock fulfilment gap.
