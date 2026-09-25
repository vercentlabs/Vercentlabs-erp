// tenant.crm_lead_assignment_policies rows via listLeadAssignmentPolicies/
// saveLeadAssignmentPolicy (assignment-engine.js) — the REAL table
// lead-governance.js's resolveLeadAssignment reads at Lead-create/assign
// time. Deliberately not the generic "assignment-rules" resource
// (tenant.crm_assignment_rules) — a different, unused table.
export const ASSIGNMENT_MODES = ["fixed", "round_robin", "workload", "territory"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export type LeadAssignmentCriteria = {
  sourceId?: string;
  countryCode?: string;
  industry?: string;
  productInterest?: string;
  leadGrade?: "cold" | "warm" | "hot" | "qualified";
};

export type LeadAssignmentPolicy = {
  id: string;
  name: string;
  sequence: number;
  criteria: LeadAssignmentCriteria;
  mode: AssignmentMode;
  assignee_user_id: string | null;
  assignee_name: string | null;
  member_user_ids: string[];
  members: { id: string; name: string; email: string }[];
  territory_id: string | null;
  territory_name: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

// F005 gap-closure — the fallback owner row (assignment/availability.js's
// getLeadAssignmentFallback/setLeadAssignmentFallback), checked once, last,
// only when no active policy above produces an eligible owner.
export type LeadAssignmentFallback = {
  fallback_user_id: string | null;
  fallback_user_name: string | null;
  fallback_user_email: string | null;
  updated_at: string | null;
};

// F005 gap-closure — an out-of-office date-range row (crm_lead_assignee_
// availability). Consulted only for automatic assignment; never blocks a
// manual override.
export type LeadAssigneeAvailability = {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
};
