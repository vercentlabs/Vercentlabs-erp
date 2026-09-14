# F080 Goods receipt (GRN) — Atomic requirement trace

Dossier: post a GRN safely against an eligible PO and trace resulting
Stock/Quality effects. Lifecycle: `DRAFT -> SUBMITTED/POSTED -> APPROVED/
ACCEPTED -> REVERSED/CANCELLED only through governed reversal`.

`receipts` is a real document resource. `normalizeDocument`'s case
(`index.js:542-550`) requires `purchaseOrderId`, `receiptDate`, at least one
line with `acceptedQuantity`/`rejectedQuantity`. `validateDocumentReferences`
requires the referenced PO to be in an eligible status (`approved/
dispatched/acknowledged/partially_received/received`). `TRANSITIONS.receipts`:
`submit/approve/reject/reverse` (`index.js:1316-1321`). `applyReceiptToOrder`
(`index.js:1346-1491`) is the real posting engine — already evidenced in
F074/F081 as genuinely strong concurrency-safe engineering.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS | Complete create/submit/approve/reject/reverse workflow, permission-gated (`procurement.receipts.manage`/`.approve`), real UI (`apps/web/src/app/(app)/procurement/receipts/`). |
| FLOW-001 (reversal only through governed action) | PASS | `reverse` is a real transition (`approved -> reversed`, requires a reason) that calls `applyReceiptToOrder(client, context, record, -1)` — a genuine compensating action that decrements the PO lines' received quantity back down and recomputes the PO's aggregate status, not a destructive delete. |
| **INT-001/002 — CONFIRMED CRITICAL GAP: no Stock effect.** | **This is the single most important finding in the whole module.** `applyReceiptToOrder` only ever touches `tenant.procurement_purchase_orders`/`_purchase_order_lines` — it never calls Stock's `postStockMovement` (confirmed exported at `services/api/src/modules/stock/index.js:188`) or any other Stock public function. `docs/04-cross-module/PROCUREMENT_TO_STOCK_RECEIVING.md` explicitly states "posting an approved receipt calls a Stock public contract with immutable PO/line, item/UOM, warehouse/location and accepted quantity evidence" — **this documented requirement is not built.** Approving a GRN today updates Procurement's own bookkeeping only; on-hand inventory in Stock does not change. This is the Procurement equivalent of Sales' own pre-Phase-2 `SALES_TO_STOCK_FULFILMENT` gap, except unfixed here. |
| **Quality effect.** | **GAP, confirmed absent.** No call to any Quality module function was found — accepted/rejected quantity is recorded on the receipt line, but there is no inspection-hold or quality-gate integration (`PROCUREMENT_RECEIPT_TO_QUALITY.md` describes this contract; not built). |
| DATA-001/002 | PASS | Real, immutable per-line quantity tracking with concurrency-safe over-receipt prevention (see F074/F081). |
| SEC-001 | PASS | Standard scoping; company cross-check between receipt and PO enforced (`receipt.company_id && orderRow.company_id !== receipt.company_id` throws). |
| E2E | GAP (module-wide) | See F063 — this is the #1 priority feature for the required Supplier→...→Payment E2E journey given it's a hard dependency of both matching (F085/F086) and the Stock-effect gap above. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The Procurement-side bookkeeping for a goods receipt — quantity tracking,
concurrency safety, reversal — is correct and well-built. But the feature
as the dossier defines it ("trace resulting Stock/Quality effects") is
**not complete**: a posted GRN has zero effect on physical inventory or
quality holds anywhere in the system. This is the highest-priority fix for
the consolidated gap-closing pass — the Supplier→Requisition→RFQ→PO→GRN→
Bill→Payment journey the task requires cannot show real Stock effects
until this is built.
