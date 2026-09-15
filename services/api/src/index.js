export * from "./core/master-data.js";
export * from "./core/document-numbering.js";
export * from "./core/idempotency.js";
export * from "./core/inventory-lock.js";
export * from "./core/references.js";
export * from "./modules/crm/index.js";
export * from "./core/billing.js";
export * from "./modules/sales/index.js";

export * from "./modules/accounting/index.js";

export * from "./modules/procurement/index.js";
export * from "./modules/crm/prospect-and-relationship-master-data/foundation.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-governance.js";

export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-operations.js";

export * from "./modules/crm/prospect-and-relationship-master-data/account-operations.js";

export * from "./modules/crm/prospect-and-relationship-master-data/contact-operations.js";

export * from "./modules/crm/prospect-and-relationship-master-data/lead-source-operations.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-lifecycle.js";
export * from "./modules/crm/prospect-and-relationship-master-data/lead-duplicates.js";

export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/sales-stage-operations.js";
export * from "./modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";

export * from "./modules/sales/quotation-governance.js";

export * from "./modules/sales/order-governance.js";

export * from "./modules/accounting/receivables-governance.js";

export * from "./modules/accounting/payables-governance.js";

export * from "./modules/accounting/banking-governance.js";

export * from "./modules/accounting/tax-reporting-governance.js";

export * from "./modules/procurement/governance.js";

export * from "./modules/crm/crm-data-operations-and-customization/core-acceptance.js";

export * from "./modules/crm/prospect-and-relationship-master-data/account-intelligence.js";

export * from "./modules/crm/prospect-and-relationship-master-data/contact-relationships.js";
export * from "./modules/crm/prospect-and-relationship-master-data/duplicate-rules.js";
export {
  findAccountDuplicates,
  findContactDuplicates,
  findLeadContactCrossMatches,
  dismissAccountDuplicateMatch,
  dismissContactDuplicateMatch,
  recordAccountDuplicateOverride,
  recordContactDuplicateOverride,
} from "./modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";

export * from "./core/release/governance.js";

export * from "./modules/crm/seller-activity-and-follow-up-workspace/communications.js";

export * from "./modules/crm/prospect-and-relationship-master-data/lead-acquisition.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js";
export {
  listLeadScoringModels,
  createLeadScoringModel,
  updateLeadScoringModel,
  activateLeadScoringModel,
  createLeadScoringModelRule,
  setLeadScoringModelRuleStatus,
  enqueueLeadScoreRecalcJob,
  getLeadScoreRecalcJob,
  processLeadScoreRecalcBatch,
  SCORE_RECALC_JOB_TYPE,
  SCORE_RECALC_BATCH_SIZE,
} from "./modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/index.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-revenue-intelligence.js";
export * from "./modules/crm/crm-data-operations-and-customization/offline-sync.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-commercial.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/stage-migration.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/stage-aging.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/pipeline-snapshots.js";
export * from "./modules/stock/index.js";
export * from "./modules/manufacturing/index.js";
export * from "./modules/projects/index.js";
export * from "./modules/assets/index.js";
export * from "./modules/point-of-sale/index.js";
export * from "./modules/quality/index.js";
export * from "./modules/support/index.js";
export * from "./modules/hr-payroll/index.js";
// task-operations.js is now also re-exported from ./modules/crm/index.js
// (line 6's `export *` already covers it) — the direct re-export here was
// removed rather than kept alongside it to avoid an ambiguous/duplicate
// star-export binding for the same symbols.

export * from "./modules/sales/pass1-operations.js";

export * from "./modules/procurement/pass1-operations.js";
export * from "./orchestration/reorder-purchasing.js";
export * from "./orchestration/procurement-stock-receiving.js";
export * from "./orchestration/procurement-accounting-vendor-bill.js";

export * from "./orchestration/sales-pass1-options.js";

export * from "./orchestration/sales-stock-reservation.js";

export * from "./orchestration/sales-stock-fulfillment.js";

// Platform reactivation port (Prompt 2 of 15) — see
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv for the source mapping.
// Every symbol below is ported from docs/frontend-rebuild/
// recovered-platform-code and re-reviewed for the current security
// standard; none of the ACTIVE code re-exported here reads from that
// parked directory at runtime.
export * from "./core/access-control-runtime.js";
export * from "./core/session.js";
export * from "./core/access-administration.js";
export * from "./core/entitlements.js";
export * from "./core/module-entitlements.js";
export * from "./core/audit-redaction.js";
export * from "./core/security.js";
export * from "./core/attachment-security.js";
export * from "./core/password-policy.js";
export * from "./core/auth-mailer.js";
export * from "./core/api-keys.js";
export * from "./core/oauth.js";
export * from "./core/notification-preferences.js";
export * from "./core/inbound-mail.js";
export * from "./core/tags.js";
export * from "./core/configuration.js";
export * from "./core/privacy.js";
export * from "./core/ai-governance.js";

// Prompt 2B — global shell closure: cross-module approval inbox,
// notification center, and background-job visibility.
export * from "./core/approvals.js";
export * from "./core/notifications.js";
export * from "./core/background-jobs.js";

export * from "./orchestration/sales-crm-opportunity-sync.js";
