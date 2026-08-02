# Stage 7 — Accounts Payable and Payment Governance

Stage 7 extends the existing Accounting and Procurement engines. It does not replace vendor-bill posting, approval, matching, settlement or journal logic.

## Delivered scope

- Vendor-bill readiness evaluation covering supplier status, snapshots, invoice references, schedules, duplicates, matching, journals and outstanding balances.
- Due-soon, overdue, stale-approval and high-risk payable health signals.
- Duplicate supplier-invoice detection within the same supplier and organisation.
- Owned payables exception cases with priority, reason, next action and audit events.
- Saved Accounts Payable views for users and governed shared views.
- Immutable governance snapshots on bill submission, match evaluation, match override, posting and credit allocation.
- Unified bill timeline across Accounting events, matching, exceptions, payment allocations, snapshots and payment proposals.
- Payment proposal creation for eligible bills within the configured horizon.
- Proposal submit, approve, reject, cancel and controlled preparation states.
- Preparation of draft vendor payments grouped by supplier, ledger and branch without bypassing existing payment approval or posting controls.
- Aging refresh and dashboard summaries for open liabilities, exceptions, payment eligibility and cash demand.
- Procurement matching records waiting for Accounting import are surfaced in the payables dashboard.
- Forced row-level security on all new tenant tables.
- Web workspace integration and existing secure mobile browser parity.

## Boundaries

- Preparing a proposal creates draft vendor payments only. Existing approval, posting, bank-journal and allocation workflows remain mandatory.
- Physical goods receipt and stock posting remain owned by Procurement and the future Inventory stage.
- A matching override continues to require the existing Accounting approval permission and reason evidence.
- One payment proposal is limited to a single company and currency.

## Migration

`database/tenant/migrations/023_accounting_payables_governance.sql`

New tables:

1. `accounting_payables_governance_policies`
2. `accounting_payables_saved_views`
3. `accounting_payables_governance_snapshots`
4. `accounting_payables_exception_cases`
5. `accounting_vendor_payment_proposals`
6. `accounting_vendor_payment_proposal_items`

## Verification gates

- Stage 7 contract verification
- Three focused Accounts Payable governance tests
- Complete API tests
- Web and mobile lint/typechecks
- Control-plane and tenant migrations
- Database, tenant, Accounting and Procurement verification
- Live payables-governance verification against PostgreSQL
- Clean commit only after every gate passes
