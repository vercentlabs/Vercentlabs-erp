# CRM data management (CRM-CAP-006)

Path: `services/api/src/modules/crm/data-management/`

Owns F021 Lead import and export (its files still live in `master-data`), F028 Custom fields and tags and F029 Bulk actions. It also holds the shared CRM record infrastructure every other capability uses: `errors.js`, `record-policy.js`, `crm-access-scope.js`, `record-utils.js`, `outbox.js`, the generic resource layer (`resource-registry.js`, `resource-query-service.js`, `resource-mutation-service.js` including `runCrmAutomation`, `resource-validation.js`, `resource-options.js`) and `offline-sync.js` for mobile.

Main files for its own features: `custom-field-runtime.js`, `tag-assignment.js`.

Depends on: most other capabilities (the resource layer calls lead, opportunity, activity and conversion rules), so it currently has two-way dependencies; see the refactor baseline.

## Boundary

Everything in this directory is private to the CRM module. Other modules, orchestration, the web app and the worker reach it only through `services/api/src/modules/crm/index.js` (enforced for other modules by `scripts/validation/verify-architecture.mjs`). Note that `services/api/src/index.js` still re-exports several files from here directly; that broad surface is pinned by `services/api/tests/crm-public-api-exports.test.mjs` until a later pass narrows it.
