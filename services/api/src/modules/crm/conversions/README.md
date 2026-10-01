# CRM conversions (CRM-CAP-007)

Path: `services/api/src/modules/crm/conversions/`

Owns F022 Lead-to-opportunity conversion (and lead merge) in `lead-conversion.js`, with transactional, replay-safe semantics.

F023 Opportunity-to-quotation is owned by Sales: the quotation is created by `services/api/src/modules/sales/` from an opportunity id, and `services/api/src/orchestration/sales-crm-opportunity-sync.js` moves the opportunity back through `moveOpportunityStage`. There is no CRM-side F023 command here yet.

Depends on: `data-management` (records, outbox, policy) and `master-data` (duplicate matching, attribution).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Package consumers (web API routes, the worker, other first-party server code) import the CRM server contract from `@vercentlabs/api/crm`, which is this module boundary; inside `services/api`, orchestration imports `modules/crm/index.js`. CRM names on the package root `@vercentlabs/api` are compatibility-only: the root reaches CRM solely through `modules/crm/index.js` and the re-export barrel `services/api/src/compat/crm-root-legacy.js` (enforced by `checkApiRootCrmBoundary`), so new CRM contracts are added to the boundary, never as root-only exports. Both export sets are pinned by `services/api/tests/crm-public-api-exports.test.mjs`; removing a root name is a deliberate breaking change for a later pass.
