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

export * from "../modules/crm/master-data/foundation.js";
export * from "../modules/crm/lead-management/lead-governance.js";
export * from "../modules/crm/lead-management/lead-operations.js";
export * from "../modules/crm/master-data/account-operations.js";
export * from "../modules/crm/master-data/contact-operations.js";
export * from "../modules/crm/master-data/lead-source-operations.js";
export * from "../modules/crm/lead-management/lead-qualification.js";
export * from "../modules/crm/lead-management/lifecycle/index.js";
export * from "../modules/crm/master-data/lead-duplicates.js";
export * from "../modules/crm/master-data/lead-attribution.js";
export * from "../modules/crm/pipeline/opportunity-operations.js";
export * from "../modules/crm/pipeline/sales-stage-operations.js";
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
export * from "../modules/crm/master-data/duplicate-scan.js";
export * from "../modules/crm/activities/communications.js";
export * from "../modules/crm/activities/public-meetings.js";
export * from "../modules/crm/master-data/lead-acquisition.js";
export * from "../modules/crm/data-management/import-export/lead-import.js";
export * from "../modules/crm/data-management/import-export/lead-export.js";
export * from "../modules/crm/lead-management/lead-intelligence.js";
export {
  listLeadScoringModels,
  createLeadScoringModel,
  updateLeadScoringModel,
  activateLeadScoringModel,
  createLeadScoringModelRule,
  setLeadScoringModelRuleStatus,
  trainLeadScoringModel,
  enqueueLeadScoreRecalcJob,
  getLeadScoreRecalcJob,
  processLeadScoreRecalcBatch,
  SCORE_RECALC_JOB_TYPE,
  SCORE_RECALC_BATCH_SIZE,
} from "../modules/crm/lead-management/scoring/index.js";
export * from "../modules/crm/pipeline/opportunity-revenue-intelligence.js";
export * from "../modules/crm/data-management/offline-sync.js";
export * from "../modules/crm/data-management/notification-visibility.js";
export * from "../modules/crm/pipeline/opportunity-commercial.js";
export * from "../modules/crm/pipeline/opportunity-contacts.js";
export * from "../modules/crm/pipeline/stage-migration.js";
export * from "../modules/crm/pipeline/stage-aging.js";
export * from "../modules/crm/pipeline/pipeline-snapshots.js";
