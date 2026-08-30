# POS Pass 8 UAT Plan

1. Open store/terminal shift with float; verify cashier scope and opening movement.
2. Scan/search variants, customer, price list, promotions/coupon/tax; complete cash/card/UPI/split sales and verify receipt.
3. Simulate payment timeout after provider success; prove no duplicate charge on retry and successful reconciliation.
4. Two terminals attempt final unit; prove deterministic Stock outcome without oversell under policy.
5. Hold/resume after price/stock change; require revalidation.
6. Return/refund/exchange with original-sale and quantity ceilings; prove no duplicate refund/restock.
7. Complete eligible offline sale and sync twice; prove one sale/Stock/Accounting effect or explicit conflict.
8. Close shift, count cash, resolve variance, produce Z report, reconcile provider tenders and Accounting handoff.
9. Verify cashier/supervisor/finance permissions, audit, responsive terminal/tablet behavior and accessibility.
