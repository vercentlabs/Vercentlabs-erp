# CRM sales organization (CRM-CAP-005)

Path: `services/api/src/modules/crm/sales-organization/`

Owns F020 Territories and sales teams: effective-dated teams, territories, coverage views and governed reassignment. Team, member and territory records themselves are generic CRM resources (`data-management/resource-registry.js`).

Main files: `coverage-service.js`, `territory-coverage.js`, `hierarchy-rules.js` (self-parent and ancestor-cycle guards applied by the generic Territory and Sales team update).

Depends on: `data-management`, `lead-management` (lead assignment), `analytics` (opportunity facts), `master-data` (accounts).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Package consumers (web API routes, the worker, other first-party server code) import the CRM server contract from `@vercentlabs/api/crm`, which is this module boundary; inside `services/api`, orchestration imports `modules/crm/index.js`. CRM names on the package root `@vercentlabs/api` are compatibility-only: the root reaches CRM solely through `modules/crm/index.js` and the re-export barrel `services/api/src/compat/crm-root-legacy.js` (enforced by `checkApiRootCrmBoundary`), so new CRM contracts are added to the boundary, never as root-only exports. Both export sets are pinned by `services/api/tests/crm-public-api-exports.test.mjs`; removing a root name is a deliberate breaking change for a later pass.
