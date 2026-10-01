# CRM pipeline (CRM-CAP-003)

Path: `services/api/src/modules/crm/pipeline/`

Owns F009 Opportunities, F010 Opportunity pipeline, F011 Probability and expected revenue, F012 Sales stages and F026 Won/lost reasons: governed opportunity pursuit, stage flow, probability and outcomes.

Main files: `opportunity-record-rules.js` (the Opportunity rules applied by the generic record commands: derived/lifecycle field guards, create defaults, contact-role sync, archive transition flag), `opportunity-operations.js`, `opportunity-transitions.js` (stage moves, probability, restore), `opportunity-validation.js`, `opportunity-commercial.js`, `opportunity-contacts.js`, `sales-stage-operations.js`, `stage-migration.js`, `stage-aging.js`, `pipeline-snapshots.js`, `opportunity-revenue-intelligence.js`.

Depends on: `data-management` (shared record infrastructure), `lead-management`, `master-data` (contacts).

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
