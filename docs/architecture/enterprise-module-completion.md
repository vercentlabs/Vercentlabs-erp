# Enterprise module completion boundary

## Released product scope

Vercentlabs ERP currently releases the shared platform foundation and four business modules:

1. **CRM** — lead capture, qualification, duplicate handling, scoring, assignment, conversion, opportunity pipeline, activities, campaigns, sequences, consent, privacy, automation, reports, imports, exports and native CRM workflows.
2. **Sales** — versioned quotations, deterministic pricing and tax evidence, approvals, secure customer decisions, quotation conversion, sales orders, holds, amendments, fulfilment requests, invoice requests and reporting.
3. **Accounting** — general ledger, chart of accounts, periods, journals, receivables, payables, settlements, banking, reconciliation, GST and compliance evidence, fixed assets, accruals, recurring entries, budgets, forecasts, foreign-exchange revaluation, intercompany, consolidation, close and financial statements.
4. **Procurement** — supplier onboarding and qualification, categories, catalogs, requisitions, sourcing events, invitations, bids, evaluations, award, agreements, purchase orders, amendments, advance shipping notices, goods and service receipt evidence, returns, two-/three-/four-way matching, exceptions, supplier performance, spend reporting, audit events and retryable outbox delivery.

The canonical catalog is `packages/shared-types/src/modules.js`. Product copy, onboarding, entitlements, readiness and release verification must derive from or agree with this catalog.

## Connected released workflows

### Lead to governed sales order

CRM opportunities can become versioned quotations. Accepted quotations convert exactly once into governed sales orders. Sales produces idempotent fulfilment and invoice requests rather than mutating Stock or Accounting tables directly.

### Source to matched payable

Procurement controls supplier qualification, requisition, sourcing, award, purchase order, receipt evidence and invoice matching. A successful match can create an idempotent draft Accounting vendor bill through `importProcurementMatchAsVendorBill`. Match exceptions cannot enter payables until resolved or overridden. The supplier must be linked to a governed Accounting business partner.

### Subledger to ledger and close

Accounting validates company, branch, ledger, period, party, currency, tax, dimensions and account mappings before posting. Posted journal evidence is immutable; corrections use governed reversals and adjustments.

## Explicit release boundary

Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll remain roadmap modules. In particular:

- Sales fulfilment requests do not claim warehouse picking, stock reservation or valuation.
- Procurement receipts provide commercial and inspection evidence but do not claim inventory movement or valuation.
- Manufacturing planning and execution, project delivery, asset operations, retail checkout, quality execution, support case management and payroll are unavailable until their own release gates pass.

This boundary prevents placeholder screens or cross-module events from being marketed as completed workflows.

## Mandatory engineering controls

Every released module must provide:

- tenant and company scope with fail-closed access;
- resource-specific validation and allowlisted persistence;
- action-specific permissions and separation of duties;
- optimistic version or idempotency controls for replay-sensitive commands;
- transactional events, audit evidence and safe retry behavior;
- database migrations with forced row-level security;
- usable web journeys and explicit mobile parity destinations;
- static, service, integration, security and release-verification coverage;
- truthful product copy and a readiness check pinned to the latest required migrations.

## Production promotion

Promotion requires Node.js 24, pnpm 11.17.0, a locked install, dependency audit, all tests, release verifiers, lint, TypeScript checks, production builds, browser journeys, database migrations and verification using the restricted runtime role. Database backup and restore rehearsal, staging acceptance and deployment smoke checks remain operational requirements.
