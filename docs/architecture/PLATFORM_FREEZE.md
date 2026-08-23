# ERP Platform Foundation Freeze

This document defines the stable foundation on which the 12 ERP business
modules are developed.

## Frozen architecture

```text
apps/web/src/
├── app/       routing and transport
├── core/      platform capabilities
├── modules/   business modules
└── shared/    dependency-light reusable web primitives

services/api/src/
├── core/          shared backend platform services
├── modules/       business-domain services
└── orchestration/ cross-module workflows

database/
├── platform/      identity, organization, access, billing and SaaS control
└── tenant/        operational ERP data

services/worker/
├── bin/           standalone process entrypoint
└── src/           queue, scheduler, handlers and delivery infrastructure
```

## Permanent business modules

1. CRM
2. Sales
3. Procurement
4. Stock
5. Manufacturing
6. Quality
7. Projects
8. Assets
9. Point of Sale
10. Support
11. HR & Payroll
12. Accounting

Their business-feature completeness is intentionally outside this platform
freeze. Features are implemented later inside the relevant module.

## Platform responsibilities

The shared foundation owns:

- authentication and session security
- tenant/organization isolation
- companies and branches
- teams, departments and users
- roles and permissions
- scoped access and module entitlement
- billing foundation
- audit foundation
- approvals and maker-checker primitives
- master/shared business data
- notifications/tasks/search/integration foundations
- import/export and reporting infrastructure
- worker/job infrastructure
- database migration/runtime-role tooling
- observability, logging, metrics, tracing and error adapters

## Dependency rules

- `shared` does not depend on `core` or business modules.
- `core` does not depend on business modules.
- business modules consume platform capabilities rather than recreating them.
- one module may not import another module's private implementation.
- cross-module workflows use public module contracts/orchestration.
- the web application never starts the background worker.
- database tooling is independent of the web workspace.

## Legacy module-boundary debt

Existing platform-boundary imports and cross-module DML at the date of this freeze are recorded in
`scripts/validation/module-boundary-debt.json`.

That file is a ceiling, not permission for new development. The platform
verification gate rejects new boundary imports and foreign-module DML. Existing
entries should be removed as the corresponding platform contracts and module
workflows are rebuilt.

## Verification

Run:

```bash
pnpm verify:platform
```

A platform change is not complete until this command succeeds.
