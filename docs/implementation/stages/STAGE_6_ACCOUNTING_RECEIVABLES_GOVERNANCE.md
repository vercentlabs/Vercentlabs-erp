# Stage 6 — Accounts Receivable, Invoicing and Collections Governance

## Objective

Stage 6 governs the existing customer-invoice and receipt engine without replacing its accounting logic. The underlying Accounting module already creates and posts customer invoices, imports Sales invoice requests, creates and allocates receipts, applies credit notes, calculates payment schedules, records tax, creates journals and runs dunning. This stage adds operational control, visibility and tenant-safe collection workflows around those capabilities.

## Delivered scope

- Organisation-level receivables policy with approval, aging, due-soon, collection and escalation thresholds.
- Invoice readiness evaluation covering lines, snapshots, payment schedules, journals, outstanding balances and customer status.
- Current, due-soon and overdue aging classification with elevated and high-risk bands.
- Accounts-receivable dashboard with invoice health, aging, collection queue, Sales invoice handoff queue and customer exposure.
- Governed collection cases with owner, priority, next action, promise-to-pay and dispute information.
- Bulk collection-case updates for up to 200 open invoices with active-member validation.
- Idempotent saved views for receivables workspaces.
- Immutable governance snapshots captured during invoice submission, posting and credit allocation.
- Unified customer-invoice timeline combining accounting events, snapshots, collection cases, receipts and dunning actions.
- Controlled overdue refresh for invoices and payment schedules.
- Web list/detail integration and verified mobile secure-browser parity.
- Migration, forced RLS, API declarations, unit tests, contract verification and live database verification.

## Deliberate boundaries

- Stage 6 does not replace the double-entry posting engine or create a second invoice model.
- It does not automatically send email, SMS or legal notices. Existing dunning actions remain provider-neutral until a communication provider is configured.
- Bulk operations change collection governance only; they do not rewrite posted financial amounts.
- Payment allocation remains in the existing receipt service so schedules, realized FX, discounts, write-offs and journals continue to reconcile in one transaction.

## Migration

`022_accounting_receivables_governance.sql` creates:

1. `accounting_receivables_governance_policies`
2. `accounting_receivables_saved_views`
3. `accounting_receivables_governance_snapshots`
4. `accounting_collection_cases`

Every table uses forced row-level security and `app.current_organization_id` tenant isolation.

## Verification gates

The installer runs the Stage 6 contract, three focused tests, the complete API test suite, web/mobile lint and typechecks, control-plane and tenant migrations, runtime-role provisioning, database verification, tenant verification, Accounting verification and a live Stage 6 transaction. The branch is committed only when every gate passes.
