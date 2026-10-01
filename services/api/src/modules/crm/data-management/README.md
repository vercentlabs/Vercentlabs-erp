# CRM data management (CRM-CAP-006)

Path: `services/api/src/modules/crm/data-management/`

Owns F021 Lead import and export (`import-export/lead-import.js`, `import-export/lead-export.js`), F028 Custom fields and tags and F029 Bulk actions. It also holds the shared CRM record infrastructure every other capability uses: `errors.js`, `record-policy.js`, `crm-access-scope.js`, `record-utils.js`, `outbox.js`, the generic resource layer (`resource-registry.js`, `resource-query-service.js`, `resource-mutation-service.js`, `resource-validation.js`, `resource-options.js`), `condition-matching.js` (the criteria matcher used by automation and record policy), `automation/automation-engine.js` (`runCrmAutomation`) and `offline-sync.js` for mobile.

Main files for its own features: `import-export/`, `custom-field-runtime.js`, `tag-assignment.js`. Import reuses the normal lead intake command (`master-data/lead-acquisition.js`) rather than writing Leads itself.

`resource-mutation-service.js` is the generic create/update/archive coordinator; Lead and Opportunity behaviour it applies lives with its owner (`lead-management/lead-record-rules.js`, `pipeline/opportunity-record-rules.js`). It must not import `conversions` (enforced by `checkCrmCapabilityImportBans`).

Depends on: lead-management, pipeline, activities, master-data and sales-organization still have reverse edges from record policy, queries, validation, offline sync and import; see the refactor reports.

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Inside the CRM module, import the owning capability file directly, never `../index.js` (enforced by `checkCrmSelfBoundaryImports` in `scripts/validation/architecture-rules.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
