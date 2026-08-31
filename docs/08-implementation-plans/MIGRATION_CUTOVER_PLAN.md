# Migration, Cutover and Reconciliation Plan

## Planning artifacts required per customer/pilot
Source inventory; field mappings; data ownership; cleansing rules; dedupe keys; transformed-value rules; attachment/document strategy; historical/open-transaction scope; opening balances; statutory identifiers; cutover window; rollback criteria.

## Rehearsal
At least one trial migration must validate row counts, control totals and business reconciliations. Finance validates trial balance/AR/AP/bank/opening balances; Stock validates quantities/valuation; HR validates employees/leave/payroll opening state; Assets validates cost/depreciation/NBV; Projects validates open budgets/actuals.

## Cutover
Freeze source writes where required, take final extract, import with idempotency, reconcile, obtain business sign-off, enable integrations, then open users. Failed reconciliation blocks go-live.
