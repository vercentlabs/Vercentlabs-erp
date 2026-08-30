# POS Pass 8 Test Strategy

- Property/unit: tax, price-list precedence, discount/promotion/coupon stacking, rounding, split tender and loyalty reversals.
- Payment fault injection: timeout-after-provider-success, duplicate callback, retry, void/refund, partial split tender and settlement mismatch.
- Concurrency: two terminals last-unit race, duplicate sale submit, return/refund race, shift-close race.
- Offline: duplicate offline transaction IDs, replay, policy/version drift, stock/serial conflict and exact-once sync.
- DB/RLS/security: tenant/company/store isolation, cashier/override negative tests, PCI-sensitive-data scanning.
- Integration/reconciliation: POS→Stock, return→Stock/Accounting, POS batch→Accounting and loyalty reversal.
- Device/E2E: scanner/printer/payment device failure, keyboard/touch accessibility, receipt reprint and offline recovery.
- Performance: peak multi-terminal product search/scan/checkout and large shift/report histories.
