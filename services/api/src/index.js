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
export * from "./modules/crm/foundation.js";
export * from "./modules/crm/lead-governance.js";

export * from "./modules/crm/lead-operations.js";

export * from "./modules/crm/account-operations.js";

export * from "./modules/crm/contact-operations.js";

export * from "./modules/crm/lead-source-operations.js";
export * from "./modules/crm/lead-qualification.js";
export * from "./modules/crm/lead-lifecycle.js";
export * from "./modules/crm/lead-duplicates.js";

export * from "./modules/crm/opportunity-operations.js";

export * from "./modules/sales/quotation-governance.js";

export * from "./modules/sales/order-governance.js";

export * from "./modules/accounting/receivables-governance.js";

export * from "./modules/accounting/payables-governance.js";

export * from "./modules/accounting/banking-governance.js";

export * from "./modules/accounting/tax-reporting-governance.js";

export * from "./modules/procurement/governance.js";

export * from "./modules/crm/core-acceptance.js";

export * from "./modules/crm/account-intelligence.js";

export * from "./modules/crm/prospect-and-relationship-master-data/contact-relationships.js";
export * from "./modules/crm/prospect-and-relationship-master-data/duplicate-rules.js";
export {
  findLeadContactCrossMatches,
  dismissAccountDuplicateMatch,
  dismissContactDuplicateMatch,
  recordAccountDuplicateOverride,
  recordContactDuplicateOverride,
} from "./modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";

export * from "./core/release/governance.js";

export * from "./modules/crm/communications.js";

export * from "./modules/crm/lead-acquisition.js";
export * from "./modules/crm/lead-intelligence.js";
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
export * from "./modules/crm/opportunity-revenue-intelligence.js";
export * from "./modules/crm/offline-sync.js";
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

export * from "./orchestration/sales-pass1-options.js";

export * from "./orchestration/sales-stock-reservation.js";

export * from "./orchestration/sales-stock-fulfillment.js";

export * from "./orchestration/sales-crm-opportunity-sync.js";
