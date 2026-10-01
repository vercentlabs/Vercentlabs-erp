// F007 Lead lifecycle — public barrel for the lead-management capability
// directory's lifecycle module, re-exported
// by services/api/src/index.js.
export {
  ensureDefaultLeadStages,
  listLeadStages,
  getLeadStage,
  createLeadStage,
  updateLeadStage,
  reactivateLeadStage,
  listLeadStageHistory,
  getLeadStageDwell,
  classifyLeadStageCustomization,
  previewLeadStageTemplateUpgrade,
  applyLeadStageTemplateUpgrade,
  FIVE_STAGE_LEAD_TEMPLATE,
  FIVE_STAGE_LEAD_GRAPH,
} from "./stage-catalog.js";

export {
  listLeadStageTransitions,
  addLeadStageTransition,
  removeLeadStageTransition,
  listLeadStageTransitionReasons,
  createLeadStageTransitionReason,
  setLeadStageTransitionReasonActive,
  findApplicableTransitionReasons,
} from "./transition-graph.js";

export { transitionLeadStage } from "./transition-engine.js";

export { isElevatedLifecycleActor } from "./shared.js";

export {
  deactivateLeadStageWithMigration,
  enqueueLeadStageMigrationJob,
  getLeadStageMigrationJob,
  processLeadStageMigrationBatch,
  STAGE_MIGRATION_JOB_TYPE,
  STAGE_MIGRATION_BATCH_SIZE,
} from "./stage-migration.js";

export { scanLeadStageDwellBreaches } from "./dwell-scan.js";
