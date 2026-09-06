# F050 Sales invoices — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `createInvoiceRequest`/`buildHandoffPayload` (Sales side, verified F047/F048) and `createInvoiceFromSalesRequest` in full (`services/api/src/modules/accounting/receivables.js:236-324`, the Accounting side that actually consumes the request) plus `scripts/validation/module-boundary-debt.json`, which already tracks this handoff's cross-module table access.

Unlike F045-F049 (Sales-to-Stock), the Sales-to-Accounting invoice handoff is **real and working** — this is the encouraging contrast after five consecutive missing-integration findings.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (request-to-invoice tracing, no double billing) | PASS | `createInvoiceFromSalesRequest` checks for an existing `accounting_customer_invoices` row keyed by `source_sales_invoice_request_id` **first**, returning it unchanged if found — a request can never produce two invoices, whether from a genuine retry or a duplicate call. |
| FLOW-001 (NOT_REQUESTED -> REQUESTED -> CREATED/POSTED or FAILED) | PASS | Real status transitions: `pending` -> `processing` (locked before work starts) -> `completed` (invoice created) or `failed` (with `last_error` captured and `retry_count` incremented) — matches the dossier's lifecycle exactly, and only `pending`/`failed` requests are eligible for (re)processing. |
| FLOW-002 (safe partial-failure retry) | PASS | Uses a `SAVEPOINT` around the actual invoice-creation work — a failure rolls back only the invoice attempt, not the whole surrounding transaction, and the request is marked `failed` with a real error message rather than left stuck in `processing`. |
| CAP-002 (ordered vs. delivered basis) | PASS | Already verified for F047: `createInvoiceRequest`'s `quantityBasis` (`'ordered'`/`'fulfilled'`) is threaded through to the invoice-creation payload. |
| CAP-002 (posting failure, Accounting traceability) | PASS | `source_sales_order_id`/`source_sales_invoice_request_id` are passed as explicit `internal`-flagged context into the invoice creation call — the resulting Accounting invoice carries its Sales origin permanently, and a failed import is fully diagnosable from `last_error` without needing to reconstruct what happened. |
| **CAP-003 (module boundary) — same debt class as F042, already tracked, not a new finding.** | Known, pre-existing debt | `receivables.js` directly `UPDATE`s `tenant.sales_invoice_requests`, `tenant.sales_order_line_progress` and `tenant.sales_orders` (confirmed: `module-boundary-debt.json` lists exactly these three) instead of Sales exposing a public "complete this invoice request" function that Accounting calls. Functionally correct and working, but the inverse of the clean pattern — here it's *Accounting* reaching into *Sales'* private tables rather than the other way around. Already flagged by the team's own debt-tracking file as something "module feature work must remove... over time," so this is a known item to pay down, not a newly discovered violation. |
| DATA-002 (tax snapshot) | PASS | The invoice payload is built from the order version's already-immutable `tax_trace`/line `tax_amount` snapshots (verified F040) — invoicing reads frozen commercial facts, not live recalculated ones. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-001/002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

The best-evidenced cross-module handoff found in Sales so far — idempotent, savepoint-protected, correctly retryable, with full traceability back to source. The only mark against it is a pre-existing, already-tracked boundary-debt item (Accounting writing directly into Sales' tables), not a functional defect.
