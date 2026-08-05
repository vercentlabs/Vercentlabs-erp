# VercentLabs ERP Point of Sale module

Point of Sale handles in-store checkout, payments, returns, cashier shifts and reconciliation.

## Ownership boundaries

- Stock remains the quantity and valuation ledger. Every completed sale and restocked return retains a Stock movement reference.
- Sales remains the commercial order system. POS may retain downstream Sales references without duplicating Sales governance.
- Accounting remains the financial ledger. POS retains payment, tax, cash and reconciliation evidence for governed Accounting handoff.
- Business Data remains the source of truth for items, warehouses, price lists, customers and tax foundations.

## Controls

- A terminal can have only one open shift.
- Checkout requires an open shift.
- Negative stock is blocked by default.
- Payment total cannot be less than the receipt total.
- Returns can require independent approval.
- Cash closing records expected, counted and variance amounts.
- Every tenant POS table uses forced PostgreSQL row-level security.
