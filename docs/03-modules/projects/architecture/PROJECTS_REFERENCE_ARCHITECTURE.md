# Projects Reference Architecture

## Ownership
Projects owns project identity/lifecycle, WBS/tasks/dependencies, project team/allocations, project time/expense workflow, analytical budgets/actuals, billing eligibility/request state, project risks/issues/collaboration and reporting projections. Sales owns commercial order truth; Procurement owns purchasing; Stock owns physical movements/valuation; HR/Payroll owns workforce/payroll; Accounting owns invoices/ledger/revenue recognition.

## Write path
Authenticate -> tenant/module -> company/project scope -> permission -> expected version/state -> domain validation -> transaction -> audit/event/outbox -> downstream public command -> reconciliation.

## Hard invariants
- no WBS/dependency cycles;
- approved baselines are immutable snapshots;
- self-approval blocked where policy says so;
- posted/locked time, expense and billing facts corrected through governed reopen/reversal;
- idempotent billing/procurement/stock/accounting effects;
- profitability always exposes source/as-of/reconciliation semantics.
