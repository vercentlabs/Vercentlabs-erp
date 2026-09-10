// F027 Lead scoring — public barrel for the lead-lifecycle-qualification-
// and-prioritization capability directory's scoring module. Canonical
// implementation location (CRM vNext Prompt 4); lead-intelligence.js
// re-exports the scoring-specific surface for compatibility.
export {
  evaluateLeadScoreRule,
  calculateLeadScoreBreakdown,
  activeModel,
  recalculateLeadScoreInternal,
  recalculateLeadScore,
  getLeadScoreExplanation,
} from "./scoring-engine.js";

export {
  listLeadScoringModels,
  createLeadScoringModel,
  updateLeadScoringModel,
  activateLeadScoringModel,
  createLeadScoringModelRule,
  setLeadScoringModelRuleStatus,
} from "./model-config.js";

export {
  enqueueLeadScoreRecalcJob,
  getLeadScoreRecalcJob,
  processLeadScoreRecalcBatch,
  SCORE_RECALC_JOB_TYPE,
  SCORE_RECALC_BATCH_SIZE,
} from "./bulk-recalc.js";
