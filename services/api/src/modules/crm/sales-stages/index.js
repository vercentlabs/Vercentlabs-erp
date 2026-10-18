// Sales Stages: the steps an open opportunity moves through (Discovery,
// Needs Analysis, Proposal, Negotiation, Closing), their order, default
// probability, description and guidance, and the few rules attached to them.
//
// Stage is where a deal is in the process; status (open, won, lost) is its
// outcome and lives on the opportunity. Moving a deal between stages is an
// opportunity operation (changeOpportunityStage in ../opportunities); this
// module defines the stages it moves between.
export { DEFAULT_SALES_STAGES, DEFAULT_STAGE_CODES, ensureDefaultSalesPipeline } from "./defaults.js";
export {
  createSalesStage, deactivateSalesStage, listSalesStages, reorderSalesStages, setStageDefaultProbability, updateSalesStage,
} from "./definitions.js";
export { STAGE_RULES, STAGE_RULE_LEVELS, stageEntryBlockers, stageEntryWarnings, stageRequirements, stageRules, suggestedStageActions } from "./rules.js";
// Several pipelines (CRM plan 5.1).
export { createPipeline, listPipelines, moveOpportunityToPipeline, pipelineForTeam, resolvePipeline, setPipelineActive, updatePipeline } from "./pipelines.js";
