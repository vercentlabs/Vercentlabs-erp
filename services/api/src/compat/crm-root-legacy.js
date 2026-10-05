// Legacy package-root CRM compatibility surface (@vercentlabs/api).
//
// Before the @vercentlabs/api/crm subpath existed, services/api/src/index.js
// re-exported these CRM implementation files directly, bypassing the CRM module
// boundary (modules/crm/index.js). Their names stay reachable from the package
// root so existing callers keep working; this file only re-exports them.
//
// Do not add statements here. New CRM contracts belong on modules/crm/index.js
// and are imported from @vercentlabs/api/crm. Removing a name from the root is
// a deliberate breaking change (see services/api/tests/crm-public-api-exports.test.mjs).

export * from "../modules/crm/data-management/core-acceptance.js";
export * from "../modules/crm/activities/communications.js";
export * from "../modules/crm/pipeline/opportunity-revenue-intelligence.js";
export * from "../modules/crm/data-management/offline-sync.js";
export * from "../modules/crm/data-management/notification-visibility.js";
