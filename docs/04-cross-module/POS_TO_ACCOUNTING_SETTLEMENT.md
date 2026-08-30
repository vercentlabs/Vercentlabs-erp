# Contract — POS to Accounting

Closed/eligible POS source batch contains company/store/shift, sales, discounts, taxes, rounding, cash/tender clearing, refunds and approved variance facts plus source transaction IDs. Accounting owns accounts, tax ledger, fiscal period locks, journal posting and reversal. Idempotency prevents duplicate posting; rejection/retry/reversal and settlement reconciliation remain visible.
