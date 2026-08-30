# Procurement → Accounting Payables Contract

Procurement captures supplier invoice and authoritative match evidence; Accounting owns posted supplier invoice/AP, tax, payment and ledger truth. The handoff includes supplier/company/currency, immutable invoice reference, matched PO/GRN lines, taxes/charges, payment terms, tolerance/override evidence and source IDs. Idempotency prevents duplicate payables. Rejection, posting failure, credit/debit correction and landed-cost entries use explicit retry/reversal/reconciliation.
