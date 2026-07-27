# Accounting Release Checklist

## Database

- [ ] Control migration `013_accounting_module_release.sql` applies once.
- [ ] Tenant migrations `009_accounting_module.sql`, `010_accounting_advanced.sql` and `011_accounting_integrity_and_compliance.sql` apply once.
- [ ] Every discovered `accounting_*` table exists.
- [ ] Every Accounting tenant table has enabled and forced RLS plus an organization policy.
- [ ] Posted journal/subledger immutability and append-only allocation triggers reject mutation.
- [ ] Posting balance guard rejects unbalanced journals.
- [ ] Every active company has one Accounting settings row, a primary ledger, at least 40 seeded accounts and nine journals.
- [ ] All Accounting numbering series, including compliance requests and cash forecasts, exist for every active organization.

## Functional flows

- [ ] Create, submit, approve, post and reverse a journal.
- [ ] Convert a Sales invoice request exactly once.
- [ ] Post a customer invoice and allocate a partial receipt.
- [ ] Match a supplier bill, approve it, post it and allocate a partial multi-currency payment with realized FX/adjustments.
- [ ] Import a bank statement, reject duplicates/overmatching, match lines and complete a zero-difference reconciliation.
- [ ] Generate a tax return from output/input/withholding rows and process an idempotent compliance request.
- [ ] Capitalize, transfer, impair, suspend/resume, depreciate and dispose an asset.
- [ ] Run a recurring journal and an accrual recognition without duplicates.
- [ ] Create, approve and activate a budget and generate a cash-flow forecast scenario.
- [ ] Calculate and post FX revaluation.
- [ ] Resolve close blockers, complete the checklist, post the year-end close where applicable and lock the period.
- [ ] Create correlated intercompany entries.
- [ ] Calculate, adjust and finalize a consolidation run.

## Security

- [ ] Cross-tenant reads and writes fail.
- [ ] Cross-company operations fail without scope.
- [ ] Posting, approval, reversal, bank reconciliation, period locks and settings require explicit permissions.
- [ ] Journal, customer invoice, supplier bill, supplier payment and budget requester/approver conflicts are prevented.
- [ ] Posted rows cannot be updated or deleted.
- [ ] Financial audit and protected bank information are not exposed publicly.

## Engineering gates

- [ ] API tests pass.
- [ ] Shared SDK tests pass.
- [ ] Web TypeScript passes.
- [ ] Web ESLint passes.
- [ ] Next.js production build passes.
- [ ] Control and tenant migrations pass.
- [ ] Control, tenant, CRM and Accounting database verifiers pass.
- [ ] Platform, Business Data, CRM, Accounting, billing and product-release verifiers pass.
- [ ] `git diff --check` passes.
- [ ] No credentials, database dumps, dependency directories or temporary files are committed.
- [ ] A verified PostgreSQL backup exists before migrations.
- [ ] Commit is created only after every gate passes.
