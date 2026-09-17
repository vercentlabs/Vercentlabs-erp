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
