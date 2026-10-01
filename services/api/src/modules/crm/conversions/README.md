# CRM conversions (CRM-CAP-007)

Path: `services/api/src/modules/crm/conversions/`

Owns F022 Lead-to-opportunity conversion (and lead merge) in `lead-conversion.js`, with transactional, replay-safe semantics.

F023 Opportunity-to-quotation is owned by Sales: the quotation is created by `services/api/src/modules/sales/` from an opportunity id, and `services/api/src/orchestration/sales-crm-opportunity-sync.js` moves the opportunity back through `moveOpportunityStage`. There is no CRM-side F023 command here yet.

Depends on: `data-management` (records, outbox, policy) and `master-data` (duplicate matching, attribution).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
