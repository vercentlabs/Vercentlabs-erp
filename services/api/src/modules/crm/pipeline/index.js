// The Opportunity Pipeline. A view and a workflow over opportunities: the
// board, its totals and the quick edits made from a card. It owns no
// opportunity data of its own, and its columns are the sales stages
// (../sales-stages): there is no second set of pipeline stages.
export { getOpportunityPipeline, getPipelineSummary } from "./board.js";
export { quickEditOpportunity } from "./quick-edit.js";
