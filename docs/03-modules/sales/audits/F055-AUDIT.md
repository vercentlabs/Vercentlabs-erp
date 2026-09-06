# F055 Credit notes and refunds — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `requestSalesCreditAdjustment` in full (`services/api/src/modules/sales/pass1-operations.js:97-108`) and confirming, via a full-repo grep for `sales_credit_adjustment_requests`, that nothing outside the Sales module — specifically nothing in Accounting — ever reads or processes it.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (request a governed correction) | PASS, at the request-creation level | `requestSalesCreditAdjustment` validates the adjustment type (`credit_note`/`refund` only), the amount against the order's `grand_total`, requires a mandatory reason, and optionally links back to a `return_request_id` — a real, validated request object, not a free-form note. |
| **CAP-001 ("while Accounting owns posted credit/refund truth") — GAP, recorded, not fixed this pass. Same "request created, never consumed" pattern as F045-F049/F052/F054.** | FAIL | Grepped the whole repository: `sales_credit_adjustment_requests` is referenced nowhere outside `pass1-operations.js` and its own test/migration. Accounting's `receivables.js` supports `isCreditNote` on invoice posting (verified F050/F051, the `-1` multiplier reversing `invoiced_quantity`), but that path is only reachable from a real accounting-side invoice/credit-note creation call — nothing ever reads a `sales_credit_adjustment_requests` row and turns it into one. The request the dossier says Sales should make into Accounting's posted truth has no bridge to actually reach it. |
| FLOW-001 (REQUESTED -> APPROVED -> POSTED/PAID or REJECTED/FAILED/CANCELLED) | FAIL | Only `REQUESTED` (implicit initial status) is ever reached — there's no status column transition anywhere. |
| CAP-002 (idempotency) | **GAP, recorded.** | Unlike `createInvoiceRequest`/`createFulfillmentRequest`/`createSalesDropShipRequest` (all of which take a caller-supplied idempotency key), `requestSalesCreditAdjustment` takes none — a retried call creates a second, independent adjustment request for the same amount/reason, with nothing to detect or collapse the duplicate. |
| CAP-002 (partial credit, refund without return, taxes/shipping, prior credits, payment method, approval) | N/A — moot given nothing ever processes the request | Same reasoning as the other request-without-consumer findings. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

Another instance of the pattern now confirmed across most of Sales' "Pass 1" financial/fulfilment extension layer: careful request-creation validation, zero downstream consumption. Unlike F050's invoice-request handoff (which is genuinely complete), credit-note/refund requests dead-end immediately after creation, and this one additionally lacks even the idempotency-key protection its sibling request functions have. Recommend the gap-closing pass audit every `sales_*_requests`/`sales_*_adjustment_requests` table for a real consumer as one sweep, rather than treating each as an independent surprise.
