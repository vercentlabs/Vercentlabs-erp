# CRM analytics (CRM-CAP-008)

Path: `services/api/src/modules/crm/analytics/`

Owns F024 Pipeline dashboard, F025 Sales forecast and F030 CRM reports: permission-safe KPIs, reproducible forecasts and governed reports. Metric definitions are documented in `docs/03-modules/crm/CRM_METRIC_DEFINITIONS.md`.

Main files: `metric-definitions.js`, `opportunity-facts.js`, `pipeline-metrics.js`, `forecast-service.js`, `analytics-service.js` (dashboard and report catalogue).

Depends on: `data-management` (records, policy, access scope) and `activities` (task overdue rule).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Package consumers (web API routes, the worker, other first-party server code) import the CRM server contract from `@vercentlabs/api/crm`, which is this module boundary; inside `services/api`, orchestration imports `modules/crm/index.js`. CRM names on the package root `@vercentlabs/api` are compatibility-only: the root reaches CRM solely through `modules/crm/index.js` and the re-export barrel `services/api/src/compat/crm-root-legacy.js` (enforced by `checkApiRootCrmBoundary`), so new CRM contracts are added to the boundary, never as root-only exports. Both export sets are pinned by `services/api/tests/crm-public-api-exports.test.mjs`; removing a root name is a deliberate breaking change for a later pass.
