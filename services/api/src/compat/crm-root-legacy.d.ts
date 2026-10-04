// Declarations for compat/crm-root-legacy.js: the legacy package-root CRM
// re-exports. Re-export statements only; CRM types for package consumers live
// on modules/crm/index.d.ts (@vercentlabs/api/crm).

// The package root declares its own QueryClient; name one here so the
// re-exported files' QueryClient declarations are not ambiguous.
export type { QueryClient } from "../index.js";
export * from "../modules/crm/data-management/core-acceptance.js";
export * from "../modules/crm/activities/communications.js";
export * from "../modules/crm/pipeline/opportunity-revenue-intelligence.js";
export * from "../modules/crm/data-management/offline-sync.js";
export * from "../modules/crm/data-management/notification-visibility.js";
