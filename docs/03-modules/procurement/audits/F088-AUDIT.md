# F088 Payment terms — Atomic requirement trace

Dossier: apply supplier payment terms, due-date/installment/discount rules,
effective snapshots consistently to purchasing and supplier invoices;
Accounting owns posted schedules/payments. Lifecycle: `DRAFT -> ACTIVE ->
INACTIVE/EXPIRED; documents retain the effective term snapshot used`.

**Not implemented at all.** `grep`ed the entire Procurement module for
`paymentTerm`, `payment_term`, `netDays`, `installment`, `"terms"`: zero
matches anywhere in `index.js`, `governance.js`, or `pass1-operations.js`.
No supplier, PO, agreement or invoice-matching code references a payment
term of any kind.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (payment terms exist and are applied) | **FAIL — not built.** | No field, no resource, no application to any document. |
| Everything else | **N/A** | Nothing to evaluate. |

## Net assessment (2026-09-14)

This feature does not exist in Procurement. If Accounting owns payment
terms and Procurement is only meant to *reference* them (per the dossier's
own framing — "Accounting owns posted schedules/payments"), the real
question for the gap-closing pass is whether Accounting's payment-terms
capability (if it exists — not checked this pass, out of scope for the
Procurement trace) is even referenceable from a Procurement PO/supplier
today. As things stand, no PO or supplier record captures a payment term
of any kind. Recorded as net-new scope, not a regression.
