// F005 Lead assignment — public barrel for the lead-management
// capability directory's assignment module. This is the canonical
// implementation location; lead-governance.js re-exports this for its
// assignment-related surface (its own non-F005 Lead-configuration
// functions stay defined there).
export { LeadGovernanceError } from "./shared.js";
export {
  crmEligibleSql,
  getEligibleLeadAssignee,
  assertEligibleLeadAssignee,
  listEligibleLeadAssignees,
  availabilitySql,
  isLeadAssigneeAvailable,
  activeTerritoryUserIds,
  leastLoadedLeadOwner,
  eligiblePolicyMemberIds,
  explainLeadAssignmentCandidates,
} from "./eligibility.js";
export {
  getLeadAssignmentFallback,
  setLeadAssignmentFallback,
  listLeadAssigneeAvailability,
  setLeadAssigneeAvailability,
  clearLeadAssigneeAvailability,
} from "./availability.js";
export {
  normalizeLeadAssignmentCriteria,
  resolveLeadAssignment,
  resolveLeadOwner,
  listLeadAssignmentPolicies,
  saveLeadAssignmentPolicy,
  setLeadAssignmentPolicyStatus,
  archiveLeadAssignmentPolicy,
} from "./assignment-engine.js";
