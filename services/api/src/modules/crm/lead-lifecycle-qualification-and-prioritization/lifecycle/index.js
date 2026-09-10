// F007 Lead lifecycle — public barrel for the lead-lifecycle-qualification-
// and-prioritization capability directory's lifecycle module. This is the
// canonical implementation location (CRM vNext Prompt 4); the legacy
// services/api/src/modules/crm/lead-lifecycle.js now only re-exports this.
export {
  ensureDefaultLeadStages,
  listLeadStages,
  getLeadStage,
  createLeadStage,
  updateLeadStage,
  reactivateLeadStage,
  listLeadStageHistory,
  getLeadStageDwell,
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

export {
  deactivateLeadStageWithMigration,
  enqueueLeadStageMigrationJob,
  getLeadStageMigrationJob,
  processLeadStageMigrationBatch,
  STAGE_MIGRATION_JOB_TYPE,
  STAGE_MIGRATION_BATCH_SIZE,
} from "./stage-migration.js";

export { scanLeadStageDwellBreaches } from "./dwell-scan.js";
