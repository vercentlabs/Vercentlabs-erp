# Stage 8 — Cash, Banking, Reconciliation and Close Governance

Stage 8 extends the existing Accounting banking, cash forecast and period-close engines. It does not replace statement import, match suggestions, reconciliation completion, journal posting, cash forecasts or close runs.

## Delivered controls

- Configurable statement import, reconciliation and exception SLAs.
- Deterministic statement health, close eligibility and high-risk aging evaluation.
- Banking governance dashboard with statement health, cash balances, exception queues and open-period banking blockers.
- Owned reconciliation exception cases with priority, reason, next action and resolution status.
- Saved banking views for personal and shared operating queues.
- Immutable governance snapshots for bank statements.
- Company cash-position snapshots using posted bank and cash ledger balances.
- Fiscal-period close-readiness snapshots based on the existing governed close blocker engine.
- Tenant-scoped APIs and secure browser parity for Banking and Close on mobile.
- Forced row-level security on every Stage 8 table.

## Existing engines retained

The implementation continues to use:

- `importBankStatement`
- `suggestBankMatches`
- `startBankReconciliation`
- `matchBankStatementLine`
- `completeBankReconciliation`
- `generateCashForecast`
- `getPeriodCloseBlockers`
- `createCloseRun`

Physical journal posting and accounting-period locking remain owned by the existing Accounting service.

## Verification gates

The installer runs the Stage 8 contract, focused tests, the complete API suite, web/mobile lint and typechecks, control-plane and tenant migrations, database verification, Accounting verification and a live transactional Stage 8 fixture before committing.
