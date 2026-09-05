# Design Convergence Go 4

Status: `GO4_COMPLETE`

Go 4 establishes the final shared page-archetype layer and the authenticated ERP
browser-gate contract.

## Canonical archetypes

The shared design package now owns five explicit layout contracts:

- `ListWorkQueueArchetype`
- `Record360Archetype`
- `TransactionDocumentArchetype`
- `BoardArchetype`
- `OperationsWorkspaceArchetype`

The archetype stylesheet uses only `--erp-*` tokens and the canonical compact,
mobile and reduced-motion media queries.

## Representative production migrations

Go 4 migrates representative, already-working surfaces while preserving their
domain owners:

- Tasks, Follow-ups, Exceptions and Approvals -> list/work queue
- CRM Account, Contact and Lead details -> Record 360
- Sales Order and Quotation details -> transaction document
- CRM Opportunity Pipeline -> board
- Stock Operations -> operations workspace

The Approval queue also adopts `EnterpriseDataGrid`, including its mobile-card
fallback and canonical empty state. This reduces legacy raw-table debt rather
than increasing it.

## Authenticated browser gate

`apps/web/playwright.erp.config.ts` defines the ERP browser suite. It requires a
dedicated non-production fixture organization and these environment variables:

- `ERP_E2E_EMAIL`
- `ERP_E2E_PASSWORD`
- `ERP_E2E_LEAD_ID`
- `ERP_E2E_SALES_ORDER_ID`
- optional `ERP_E2E_BASE_URL` when testing an already-running deployment

The suite verifies:

1. authenticated navigation remains out of `/login`;
2. the expected `data-erp-archetype` is present on each representative route;
3. compact 320px, mobile 390px, tablet 768px and desktop 1440px layouts do not
   introduce page-level horizontal overflow;
4. reduced-motion preference is exercised;
5. axe-core reports no serious or critical WCAG 2.2 AA-oriented violations;
6. desktop and mobile screenshots match reviewed Playwright baselines.

Run the gate with:

```bash
corepack pnpm --filter @vercentlabs/web test:e2e:erp
```

A first controlled fixture run will fail if screenshot baselines do not yet
exist. Review the captured UI before explicitly creating/updating baselines with:

```bash
corepack pnpm --filter @vercentlabs/web test:e2e:erp:update
```

The convergence installer never auto-updates screenshot baselines, because doing
so would convert an unreviewed visual change into the accepted baseline.

## Safety boundary

Go 4 changes only shared presentation contracts, representative view composition,
browser-test tooling and documentation. Existing authentication, authorization,
database schemas, APIs, calculations, write workflows and cross-module state
transitions remain in their current owners.
