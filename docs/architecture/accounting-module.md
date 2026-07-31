# Vercentlabs ERP Accounting Module

## Purpose

Accounting is the governed financial system of record for Vercentlabs ERP. It receives auditable source events from Sales and future Procurement, Stock, Manufacturing, Payroll, Projects and Assets modules, converts those events into balanced subledger and general-ledger postings, and produces company and consolidated financial statements.

The module is accrual-first. Cash-basis reporting is an optional reporting view and never weakens the double-entry ledger.

## Design principles

1. Every posted journal is balanced in transaction and base currency.
2. Posted journals and lines are immutable. Corrections use reversals and replacement entries.
3. Source documents remain linked to subledger events and journal entries.
4. General ledger, receivables, payables, banking, tax, assets and close use one accounting context and chart of accounts.
5. Tenant, company, ledger, branch, fiscal period and currency scope are validated server-side.
6. Decimal/BigInt arithmetic is authoritative; browser totals are previews only.
7. Posting requires an open period and respects soft-close and hard-lock controls.
8. All write commands are permission-gated, audited and idempotent where external handoffs can retry.
9. RLS is enabled and forced for every tenant Accounting table.
10. Financial reports derive from posted journal lines, not editable operational documents.

## Capability map

### General ledger

- Multi-company ledgers and functional currency
- Hierarchical chart of accounts
- Account classes, types and normal balances
- Manual, sales, purchase, bank, cash, tax, closing and intercompany journals
- Draft, submitted, approved, rejected, posted, reversed and cancelled journal states
- Approval thresholds and content-hash binding
- Reversal journals and immutable posted entries
- Branch, department, cost-centre and custom accounting dimensions
- Posting rules and source-to-ledger event history
- Trial balance, general ledger, journal register, profit and loss, balance sheet and cash-flow reporting

### Accounts receivable

- Customer invoices, credit notes, exact multi-installment schedules and approval thresholds
- Sales invoice request conversion with idempotent source references
- Revenue, tax, charge and rounding postings
- Customer receipts and allocations
- Open-item balances, aging, statements, collection queues and dunning
- Foreign-currency invoices, partial settlement, cash discounts, write-offs and realized FX journals

### Accounts payable

- Supplier bills, credit notes, exact multi-installment schedules and approval thresholds
- Expense, tax, charge and rounding postings
- Supplier payments and allocations
- Governed payment lifecycle with submitter/approver separation and hash-bound approval evidence
- Open-item balances, aging and supplier statements
- Two-way, three-way and manual matching with variance tolerances and controlled overrides
- Foreign-currency bills, partial settlement, cash discounts, write-offs and realized FX journals

### Banking and reconciliation

- Bank and cash accounts linked to GL accounts
- Robust CSV statement import with quoted-field parsing, source hashing and duplicate protection
- Match suggestions against receipts, payments and journals
- Reconciliation sessions, partial line-level matches and exact closing-balance controls
- Bank suspense, bank charges and reconciliation status reporting

### Tax accounting

- Component-level tax ledger for input, output and withholding taxes
- Jurisdiction, tax type, source document and party traceability
- Tax return headers and return lines
- Period tax summary separating output, recoverable input and withholding positions
- Durable statutory compliance outbox for GST e-invoice, e-way bill, TDS and future adapters
- Tax configuration remains effective-dated and separate from changing government gateway integrations

### Fixed assets

- Asset categories and account mappings
- Capitalization from acquisition cost
- Straight-line, declining-balance and manual schedule support
- Depreciation schedules and posted depreciation transactions
- Asset transfers, suspension/resumption, impairment, disposal and write-off with governed journal effects
- Asset register and net-book-value reporting

### Planning, recurring accounting and close

- Budgets and forecasts with approval, activation and control modes
- Cash-flow forecast scenarios from open receivables, payables and manual assumptions
- Budget-versus-actual reports
- Recurring journal templates and idempotent executions
- Accrual and deferral schedules with due-recognition posting
- Month, quarter and year-end close runs and tasks
- Fiscal-period open, soft-close and lock states
- Close blockers across journals, AR, AP, bank reconciliation, AP matching, Sales handoffs, compliance, recurring jobs, accruals, FX and tax
- Idempotent year-end P&L closing into retained earnings

### Foreign currency, intercompany and consolidation

- Transaction currency, functional currency and exchange-rate snapshots
- FX exposure and revaluation runs
- Unrealized gain/loss posting
- Intercompany rules with due-to/due-from mappings
- Correlated mirrored intercompany journals
- Consolidation groups, ownership percentages, translated balances, eliminations and adjustments
- Finalized consolidation runs with audit history

## Boundaries

### Sales

Sales owns quotations, orders, fulfilment status and invoice requests. Accounting owns posted customer invoices, receivables, receipts, allocations, tax ledger and GL postings. `sales_invoice_requests` are consumed exactly once and retain their source snapshot.

### Procurement

Procurement will own requisitions, purchase orders, receipts and supplier commercial terms. Accounting owns supplier bills, payables, payments and GL/tax effects.

### Stock and manufacturing

Stock and Manufacturing will own quantities, valuation events, production and cost layers. Accounting will receive governed valuation events and post inventory, WIP, variance and cost-of-sales entries.

### Payroll

Payroll will own employee calculations and payslips. Accounting will receive approved payroll posting batches and post payroll expense, liabilities and bank-clearing entries.

## Status model

A source document and its journal entry have independent statuses. An invoice may be posted while partly paid; a journal may be approved but not posted; a bank statement may be imported but not reconciled. Statuses must never be collapsed into one generic processing state.

## Security and audit

- Cost, financial statements, bank information and audit views require Accounting permissions.
- The requester cannot silently approve governed entries.
- Approval is bound to the submitted content hash.
- Posted rows cannot be edited or deleted.
- Reversals retain the original entry link.
- Every command writes an Accounting event and the platform audit log where invoked through HTTP.
- Public or cross-tenant access to Accounting data is prohibited.

## Release contract

Accounting is released only when migrations, forced RLS, permissions, company foundations, numbering, tests, TypeScript, lint, build, database verifiers, source verifiers and product-release verification all pass. Accounting changes may be committed only after the repository release gate, database verifiers, migration checks and manual acceptance evidence pass.

## Enterprise control extensions

- Custom financial dimensions and values can be required by account class and allocated 100% across journal lines.
- Subledger approvals are threshold-driven, content-hash bound and prohibit self-approval.
- AP matching records purchase-order and receipt references without pretending Procurement exists before its module is released.
- Payment allocations are append-only and preserve transaction, document and base-currency amounts.
- Compliance requests are durable, idempotent and retryable; government-provider adapters remain replaceable integrations.
- Cash forecasts retain scenario assumptions and generated source lines instead of overwriting actual ledger data.
- Close workspaces expose blockers and evidence-bearing tasks before soft close, lock and year-end completion.
