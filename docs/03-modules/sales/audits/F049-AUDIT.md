# F049 Delivery and shipment — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by grepping the full schema (case-insensitive) for `tracking_number`/`carrier`/`proof_of_delivery`/any `shipment` table: zero matches anywhere in `database/tenant/migrations`.

| ID | Verdict | Evidence |
|---|---|---|
| **CAP-001 (entire capability) — GAP, recorded, not fixed this pass. Same root cause as F045-F048.** | FAIL | No shipment/delivery entity exists anywhere in the schema — no carrier, no tracking number, no proof-of-delivery, no dedicated shipment table distinct from the generic `sales_fulfillment_requests` (a plain request/complete pair with a JSON payload, verified for F047). This is the fifth consecutive Sales feature (F045-F049) that turns out to be a facet of the same unimplemented `docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md` contract — delivery/shipment evidence is exactly what a real fulfilment integration would need to carry back from Stock/Warehouse, and it isn't there because that integration isn't there. |
| FLOW-001 (READY -> PICKING/PACKING -> SHIPPED -> DELIVERED, FAILED/CANCELLED/RETURNED) | FAIL | None of these states exist; `sales_fulfillment_requests.status` only has `pending`/`processing`/`completed`/`failed` (verified F047) — a request-lifecycle status, not a shipment-lifecycle one. |
| CAP-002 (multiple shipments, carriers/tracking, proof of delivery, customer notification) | N/A — moot until the base entity exists | Same reasoning as F045/F048. |

## Net assessment (2026-09-06)

No independent finding beyond confirming the pattern already established across F045-F048: this is another symptom of the single missing Sales-to-Stock fulfilment integration, not a new problem. See F046's audit for the full evidence trail and the `docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md` reference. Recommend the gap-closing pass treat F045/F046/F047/F048/F049 as one integration effort.
