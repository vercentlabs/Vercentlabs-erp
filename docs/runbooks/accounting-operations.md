# Accounting Operations Runbook

## Daily controls

1. Review failed Sales invoice handoffs and create customer invoices from valid requests.
2. Submit and approve governed customer invoices, supplier bills and supplier payments before posting.
3. Record and allocate customer receipts and supplier payments.
4. Import bank statements, review duplicate detection and complete balanced reconciliations.
5. Review unposted journals, rejected approvals and suspense-account movements.
6. Review overdue receivables and dunning actions.
7. Confirm output, recoverable input and withholding tax ledgers reconcile with posted source documents.
8. Review failed statutory compliance requests and retry only with the same idempotency key.
9. Refresh cash-flow forecast scenarios when AR, AP or assumptions change.

## Journal processing

- Create a draft with at least two lines.
- Confirm transaction-currency and base-currency debit and credit totals match.
- Submit the content for approval when the journal or company threshold requires it.
- Approve only the exact submitted content hash.
- Post only into an open fiscal period.
- Correct posted errors by reversal; never edit posted rows.

## Receivables

- Convert each Sales invoice request once.
- Confirm customer, currency, due date, tax and revenue account mappings.
- Post the invoice, then allocate receipts against open schedules.
- Keep unapplied cash visible until a valid allocation is selected.
- Use dunning based on overdue open amounts and recorded customer contact.

## Payables

- Validate supplier identity, duplicate supplier invoice number, dates and tax.
- Evaluate two-way/three-way matching and resolve or explicitly override exceptions before posting.
- Route governed bills or payments for approval; the submitter must not approve the same document.
- Post supplier bills before allocation.
- Allocate payments only against posted open schedules.
- Keep payment batches and bank clearing traceable.

## Banking

- Use stable statement and transaction identifiers when importing.
- Reject duplicate statement lines rather than silently duplicating cash.
- Review match confidence and source references before confirming.
- Prevent overmatching and finish reconciliation only when the computed statement-to-ledger difference is zero.
- Reconcile the GL balance to the statement closing balance.

## Period close

1. Create the close run for the company, ledger and fiscal period.
2. Resolve unposted or unapproved journals.
3. Complete bank reconciliations.
4. Post due recurring journals, accruals, depreciation and FX revaluation.
5. Review AR, AP, tax, fixed-asset and bank-to-GL reconciliations.
6. Review suspense, rounding and intercompany balances.
7. Resolve the generated close blockers, then complete tasks with evidence and notes.
8. Soft-close for review, then hard-lock only after approval.
9. For year-end, generate the idempotent P&L closing journal to retained earnings before final completion.
10. Reopening a locked period requires explicit permission, reason and audit trail.

## Foreign currency

- Maintain effective exchange rates before posting transactions.
- Run revaluation at the reporting date for eligible monetary balances.
- Review exposure, source rate, closing rate and calculated gain/loss.
- Post to configured unrealized gain/loss accounts.
- Reverse or settle revaluation entries according to the company policy.

## Intercompany and consolidation

- Configure reciprocal due-to and due-from accounts.
- Use intercompany rules to create correlated entries in both companies.
- Confirm functional-currency conversion and source correlation.
- Run consolidation after all members are closed for the period.
- Review ownership percentages, translated balances and elimination adjustments.
- Finalize only after reconciliation differences are resolved.

## Backup and recovery

Before Accounting migrations, run the repository custom-format PostgreSQL backup and verify it with `pg_restore --list`. The installer stores the verified backup and checksum outside the repository under the user backup directory. On migration or verification failure, restore with `scripts/database/restore-postgres.sh`, rerun all database verifiers, and do not permit application traffic until they pass.

## Incident response

- Stop posting if the balance guard, RLS verifier or period-control check fails.
- Preserve the database backup, logs, failed payload and correlation identifiers.
- Do not manually update posted journal tables.
- Repair source configuration or create governed reversal/replacement entries.
- Re-run Accounting, CRM, Sales and platform verification after remediation.
