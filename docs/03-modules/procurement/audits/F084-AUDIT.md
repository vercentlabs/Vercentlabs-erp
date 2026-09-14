# F084 Supplier invoices — Atomic requirement trace

Dossier: capture a supplier invoice and trace validation/matching plus the
Accounting handoff without duplicate payable creation. Lifecycle: `DRAFT/
IMPORTED -> VALIDATING -> MATCHING -> APPROVED/POSTED or EXCEPTION/
REJECTED/CANCELLED`.

Procurement does **not** own a `supplier-invoices` resource — there is no
such entry in `RESOURCE_CONFIG`. The actual implementation is
`runProcurementMatch` (`index.js:1929-2310`), which captures invoice
number/lines/currency **as part of the matching call itself** and, on a
clean match, fires an outbox event intended to hand off to Accounting.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (invoice capture) | PASS (as matching input, not a standalone document) | `runProcurementMatch` requires `invoiceNumber`, `invoiceLines`, `currencyCode`, validates the invoice's supplier/currency against the PO, and **hard-blocks duplicate invoice numbers per supplier** (`SELECT ... FROM procurement_invoice_matches WHERE ... upper(invoice_number)=upper($4) FOR UPDATE` → `PROCUREMENT_DUPLICATE_INVOICE`) — this directly satisfies the dossier's "without duplicate payable creation" requirement at the Procurement layer. |
| FR-002/DATA-002 | PASS | `procurement_invoice_matches` is a real, permanent ledger row per match attempt (not overwritten), carrying the full computed `matchingRecord` payload (issues, variance, tolerance used, override reason if any). |
| **INT-001/002 — CONFIRMED GAP: the Accounting handoff is a dead outbox event.** | On a clean match (no issues), the code calls `outbox(client, context, purchaseOrder, "procurement.vendor-bill.ready", {...matchingRecord, invoiceMatchId})` — this is the *only* signal meant to create the actual Accounting-side vendor bill/payable. Per F063's shared finding, `procurement_outbox` is **never consumed anywhere** in the codebase (no worker handler, no orchestration). **A cleanly matched supplier invoice today never produces a real Accounting bill or payable — the "Accounting handoff" the dossier requires does not happen.** This is, together with F080's missing Stock effect, one of the two most critical findings in the module: the Supplier→...→Payment journey the task requires cannot reach "Payment" without this being fixed. |
| VAL-001 (currency/supplier cross-check) | PASS | Invoice supplier/currency must match the PO's; mismatches are hard errors (`PROCUREMENT_MATCH_SUPPLIER`/`PROCUREMENT_MATCH_CURRENCY`), not silently accepted. |
| SEC-001 | PASS | Gated by `procurement.matching.manage`; tolerance override additionally requires `procurement.matching.override` plus a mandatory reason. |
| UX | **GAP.** No dedicated "supplier invoices" list/detail page exists in the web app — invoices only exist as an input to the matching action (`apps/web/src/app/(app)/procurement/matching/`), not as a browsable document with their own lifecycle status shown to a user. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The duplicate-invoice guard and matching-input validation are real and
correctly enforced. But the feature's core promise — invoice capture that
results in an actual Accounting payable — is broken at the last step: the
outbox event that's supposed to trigger bill creation is never consumed.
**Fixing the outbox-to-Accounting handoff (or replacing it with a direct
orchestration call, matching how Sales' own invoice-to-Accounting handoff
was built) is a release-blocking fix for the required Supplier→...→
Payment journey**, not an optional enhancement.
