# CRM sales organization (CRM-CAP-005)

Path: `services/api/src/modules/crm/sales-organization/`

Owns F020 Territories and sales teams: effective-dated teams, territories, coverage views and governed reassignment. Team, member and territory records themselves are generic CRM resources (`data-management/resource-registry.js`).

Main files: `coverage-service.js`, `territory-coverage.js`.

Depends on: `data-management`, `lead-management` (lead assignment), `analytics` (opportunity facts), `master-data` (accounts).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
