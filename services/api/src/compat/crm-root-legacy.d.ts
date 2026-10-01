// Declarations for compat/crm-root-legacy.js: the legacy package-root CRM
// re-exports. Re-export statements only; CRM types for package consumers live
// on modules/crm/index.d.ts (@vercentlabs/api/crm).

// The package root declares its own QueryClient; name one here so the
// re-exported files' QueryClient declarations are not ambiguous.
export type { QueryClient } from "../index.js";
export * from "../modules/crm/master-data/account-operations.js";
export * from "../modules/crm/master-data/contact-operations.js";
export * from "../modules/crm/master-data/lead-source-operations.js";
export * from "../modules/crm/lead-management/lead-qualification.js";
export * from "../modules/crm/lead-management/lead-operations.js";
export * from "../modules/crm/pipeline/opportunity-operations.js";
export * from "../modules/crm/pipeline/sales-stage-operations.js";
export * from "../modules/crm/pipeline/stage-aging.js";
export * from "../modules/crm/pipeline/pipeline-snapshots.js";
export * from "../modules/crm/activities/attachments/attachments-operations.js";
export * from "../modules/crm/data-management/core-acceptance.js";
export * from "../modules/crm/master-data/account-intelligence.js";
export * from "../modules/crm/master-data/contact-relationships.js";
export * from "../modules/crm/master-data/duplicate-rules.js";
export {
  findAccountDuplicates,
  findContactDuplicates,
  findLeadContactCrossMatches,
  projectDuplicateMatchesForCaller,
  dismissAccountDuplicateMatch,
  dismissContactDuplicateMatch,
  recordAccountDuplicateOverride,
  recordContactDuplicateOverride,
} from "../modules/crm/master-data/duplicate-matching.js";
export * from "../modules/crm/activities/communications.js";
export * from "../modules/crm/master-data/lead-acquisition.js";
export * from "../modules/crm/data-management/import-export/lead-import.js";
export * from "../modules/crm/data-management/import-export/lead-export.js";
export * from "../modules/crm/lead-management/lead-intelligence.js";
export * from "../modules/crm/pipeline/opportunity-revenue-intelligence.js";
export * from "../modules/crm/pipeline/opportunity-contacts.js";
export * from "../modules/crm/data-management/offline-sync.js";
export * from "../modules/crm/data-management/notification-visibility.js";
