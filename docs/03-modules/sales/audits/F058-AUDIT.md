# F058 Payment terms — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `tenant.payment_terms`/`tenant.payment_term_lines` (`database/tenant/migrations/001_business_data_foundation.sql:156-183`), `loadDocumentContext`'s payment-term resolution (verified F031/F032), and tracing `resolvePaymentSchedule` (`services/api/src/modules/accounting/schedules.js`) into `createCustomerInvoice` (`services/api/src/modules/accounting/receivables.js:181-224`, which the Sales-invoice-request handoff calls, verified F050).

Sales correctly doesn't own `payment_terms` — it's shared master data (like `price_lists`), consumed read-only, matching CAP-003's boundary.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (apply consistently from quotation through invoice) | PASS | `paymentTermId = input.paymentTermId \|\| party.payment_term_id` (verified F031) gives a real customer-default fallback; the resolved term is snapshotted at quotation/order version creation (`payment_term_snapshot`, verified F032/F037) and carried through to invoicing — one resolution path, not re-derived inconsistently at each stage. |
| CAP-002 (installments) — corrected finding: this is real, not a gap | PASS | `payment_term_lines` (a real installment schedule: `sequence`/`due_days`/`percentage`) is **not** ignored by the Sales-to-Accounting invoice path as it first appeared — `createCustomerInvoice` (the function `createInvoiceFromSalesRequest` calls internally, verified F050) imports and calls `resolvePaymentSchedule` from `schedules.js`, which resolves the full installment breakdown and persists `paymentSchedule.installments` on the invoice. A multi-installment payment term configured on a customer is genuinely honored end-to-end from a Sales-originated invoice. |
| CAP-002 (inactive terms) | PASS | Every payment-term lookup in Sales filters `status='active'` (verified F031/F032) — an inactive term can't be newly selected, though (not independently verified) existing documents presumably retain their historical snapshot regardless of the term's later status, consistent with the snapshot pattern verified elsewhere. |
| CAP-002 (customer defaults, override permission) | PASS | The customer's own `payment_term_id` is the default; nothing in `loadDocumentContext` restricts overriding it to a specific permission — any user who can create a quotation/order can choose a different active term. Whether that should be permission-gated wasn't specified narrowly enough by the dossier to call this a gap. |
| CAP-002 (early-payment discounts, end-of-month rules) | **GAP, recorded.** | Neither `payment_terms` nor `payment_term_lines` has any column for an early-payment discount percentage/window or an end-of-month cutoff rule — `default_due_days`/`due_days` are the only timing mechanism. These two dossier-named refinements are genuinely absent from the schema, not just unused. |
| DATA-002 (snapshot) | PASS | `payment_term_snapshot` on both quotation and order versions (verified repeatedly) — a later edit to the payment term definition can't retroactively change what a historical document actually committed to. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / UX-001-003 / VAL-001/002 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

Better than initially suspected — tracing the invoice-creation call chain corrected an assumption that installments were being silently ignored; they're genuinely resolved end-to-end via `schedules.js`. The one real gap is a schema-level absence: no early-payment-discount or end-of-month-cutoff support at all, not a wiring problem.
