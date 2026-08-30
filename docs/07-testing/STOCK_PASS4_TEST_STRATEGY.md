# Stock Pass 4 Test Strategy

- Property/invariant tests: movement sum/balance, reserved<=eligible quantity, no unauthorized negative stock, UOM round-trip bounds, serial uniqueness, valuation conservation/reversal.
- Database/RLS: cross-org/company/warehouse negative tests and request-transaction tenant context.
- Concurrency: competing reserve/issue/transfer/count, deadlock retry and idempotent replay.
- Integration: Procurement receipt/landed cost, Sales reservation/shipment/return, Manufacturing material flow, POS issue, Quality hold/release, Accounting valuation reconciliation.
- E2E/mobile: barcode/manual receipt, transfer, cycle count, pick-pack-ship, held stock denial, traceability recall.
- Performance: million-movement ledger/as-of reporting, hot-SKU contention and dashboard query budgets.
