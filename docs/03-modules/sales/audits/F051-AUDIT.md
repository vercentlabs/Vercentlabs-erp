# F051 Partial invoicing — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `receivables.js`'s `postCustomerInvoice`/line-processing logic in full (`services/api/src/modules/accounting/receivables.js:258-296, 405-424`, already partially read for F050).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (multiple invoices without over-invoicing) | PASS, with real re-validation at processing time | The invoice-line builder re-checks `invoiceQuantity > available` against **live** `source.invoiced_quantity`/`fulfilled_quantity`/`cancelled_quantity` read fresh at processing time (`:271-280`) — it does not trust the (potentially stale) quantity captured when the request was originally created. A request sitting in `pending` while another invoice posts against the same order cannot later over-invoice; the re-check catches it. |
| FLOW-001 (OPEN -> PARTIALLY_INVOICED -> FULLY_INVOICED) | PASS | `sales_orders.billing_status` is recomputed on every invoice posting via a real per-line `EXISTS` check (`invoiced_quantity < line.quantity - cancelled_quantity`) — `partially_invoiced` if any line still has remaining billable quantity, `fully_invoiced` otherwise (`:423`). Not a guess or a simple counter — a correct, line-aware aggregate. |
| CAP-002 (delivered basis) | PASS | `request.quantity_basis === "fulfilled"` switches the `available` calculation to `fulfilled_quantity - invoiced_quantity` instead of `ordered - invoiced - cancelled` — delivered-basis billing is a real, distinct code path, not a cosmetic label. |
| CAP-002 (credit effects) | PASS | Credit notes apply the inverse (`isCreditNote ? -1 : 1` multiplier on `invoiced_quantity`, `:420`) — issuing a credit note correctly reduces the invoiced-quantity ledger back down, so a subsequent invoice request sees accurate remaining quantity, not double-counted history. |
| CAP-002 (rounding residue proportionality) | PASS | Partial-line invoicing computes a `ratio = invoiceQuantity / source.quantity` and applies it to `discountAmount`/`taxAmount` (`:281-291`) — a partial invoice correctly gets a proportional share of the line's discount/tax, not the full line's tax charged against a fraction of the quantity. |
| DATA-002 (reconciliation) | PASS | `invoiced_quantity` is a running total on `sales_order_line_progress`, guarded with `GREATEST(0, ...)` against going negative even under odd sequencing of credit notes vs. invoices. |
| FLOW-002 (concurrency/safety) | PASS | Runs inside the same `SAVEPOINT`-protected transaction verified for F050 — the quantity re-check, invoice creation, and progress update are all atomic together. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-001/002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

No gap found. This is careful, correct engineering — re-validating against live quantities rather than trusting a request-time snapshot is exactly the kind of detail that prevents a real over-invoicing bug under concurrent activity, and the credit-note reversal and delivered-basis handling are both genuine, not superficial.
