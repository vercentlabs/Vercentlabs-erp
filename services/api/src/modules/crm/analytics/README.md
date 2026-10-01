# CRM analytics (CRM-CAP-008)

Path: `services/api/src/modules/crm/analytics/`

Owns F024 Pipeline dashboard, F025 Sales forecast and F030 CRM reports: permission-safe KPIs, reproducible forecasts and governed reports. Metric definitions are documented in `docs/03-modules/crm/CRM_METRIC_DEFINITIONS.md`.

Main files: `metric-definitions.js`, `opportunity-facts.js`, `pipeline-metrics.js`, `forecast-service.js`, `analytics-service.js` (dashboard and report catalogue).

Depends on: `data-management` (records, policy, access scope) and `activities` (task overdue rule).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
