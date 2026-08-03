# Stage 9 — Tax, Statutory Compliance and Financial Reporting Governance

Stage 9 extends the existing Accounting tax ledger, returns, statutory outbox and financial-reporting engines. It does not replace tax posting, journal posting, tax-return generation, provider adapters or the general-ledger reporting service.

## Delivered controls

- Configurable filing-warning, exception-escalation and reconciliation-tolerance policies per company.
- Deterministic tax-return health, filing readiness, due-date risk and statutory evidence evaluation.
- Tax governance dashboard with ready, attention, blocked, overdue and high-risk queues.
- Owned tax exception cases with priority, reason, next action and resolution status.
- Saved tax views for personal and shared filing queues.
- Immutable tax-return governance snapshots captured on generation and status changes.
- Governed financial-reporting snapshots with row counts, numeric totals, evidence payloads and deterministic content hashes.
- Close-pack snapshot support across trial balance, profit and loss, balance sheet, cash flow, tax summary and subledger reconciliation.
- Subledger reconciliation blocking based on the configured reporting tolerance.
- Tenant-scoped operations APIs and secure-browser mobile parity for Tax and Reports.
- Forced row-level security on every Stage 9 table.

## Existing engines retained

The implementation continues to use:

- `recordDocumentTaxLedger`
- `createTaxReturn`
- `updateTaxReturnStatus`
- `createComplianceRequest`
- `updateComplianceRequest`
- `getTrialBalance`
- `getProfitAndLoss`
- `getBalanceSheet`
- `getCashFlow`
- `getTaxSummary`
- `getSubledgerReconciliation`
- `getAccountingReport`

Government filing providers remain versioned compliance adapters. Stage 9 governs evidence, readiness and exceptions without hard-coding an external government API into financial posting.

## Verification gates

The installer runs the Stage 9 contract, three focused tests, the complete API suite, web/mobile lint and typechecks, control-plane and tenant migrations, database verification, Accounting verification and a live transactional Stage 9 fixture before committing.
