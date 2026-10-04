// The Opportunities domain. Routes and other modules import from here; each
// opportunity operation is one function (createOpportunity, assignOpportunity,
// changeOpportunityStage, markOpportunityWon, …) taking (client, context, …)
// and running inside the caller's transaction.
export * from "./constants.js";
export { canViewAllOpportunities, opportunityCan, opportunityCapabilities, opportunityScopeSql } from "./access.js";
export {
  OPPORTUNITY_VIEWS, archiveOpportunity, createOpportunity, deleteOpportunity, getOpportunity, listOpportunities, restoreOpportunity, updateOpportunity,
} from "./records.js";
export {
  bulkChangeOpportunityStage, changeOpportunityStage, listOpportunityStageHistory, listOpportunityStages, setOpportunityProbability,
} from "./stages.js";
export {
  correctOpportunityCloseReason, listOpportunityCloseHistory, markOpportunityLost, markOpportunityWon, moveOpportunityStage, reopenOpportunity,
} from "./outcome.js";
export { assignOpportunity, bulkAssignOpportunities, listOpportunityAssignmentHistory, reassignOpportunity } from "./assignment.js";
export { addOpportunityProduct, listOpportunityProducts, removeOpportunityProduct, searchOpportunityProducts, updateOpportunityProduct } from "./products.js";
export { addOpportunityContact, listOpportunityContacts, removeOpportunityContact, updateOpportunityContact } from "./contacts.js";
export { findDuplicateOpportunities } from "./duplicates.js";
export { addOpportunityActivity, listOpportunityActivities, scheduleOpportunityFollowUp } from "./activities.js";
export { exportOpportunities, getOpportunitiesByStageReport, getOpportunityDashboard } from "./dashboard.js";
export { getOpportunityOptions } from "./options.js";

import { getOpportunity } from "./records.js";
import { listOpportunityHistoryEntries } from "./history.js";

// The audit trail of one opportunity, behind the opportunity's own visibility.
export async function listOpportunityHistory(client, context, opportunityId, options = {}) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  return listOpportunityHistoryEntries(client, context, opportunity.id, options);
}
