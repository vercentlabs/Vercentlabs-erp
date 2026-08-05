# VercentLabs ERP Projects module

Projects connects delivery execution with commercial and financial performance.

## Ownership boundaries

- Projects owns project structures, milestones, tasks, dependencies, resource assignments, time, expenses, budgets, billing milestones and profitability views.
- Procurement remains the source of truth for requisitions, purchase orders, receipts and supplier commitments. Projects stores governed links and allocated amounts.
- Sales and Accounting remain the source of truth for customer billing and invoices. Projects creates billing intent and retains downstream identifiers.
- Accounting remains the financial ledger. Projects calculates operational profitability from approved time, expenses, procurement links and billing evidence but does not write general-ledger entries directly.

## Controls

- Project closure is blocked while tasks remain incomplete.
- Time and expense approval are separated from entry.
- Self-approval of time is blocked.
- Project budgets are versioned.
- Billing requests are idempotent.
- Every tenant Projects table uses forced PostgreSQL row-level security.
