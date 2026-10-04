// The fixed vocabulary of a lead. Stage answers "where are we in the
// process?"; status answers "what is the outcome of this record?". They are
// separate columns and change through separate operations.
// The system stages every organization starts with. The stage list itself
// lives in the database (stages.js): administrators can rename and reorder
// these and add their own, so code tests the stage code, never the name.
export const DEFAULT_LEAD_STAGES = Object.freeze([
  { code: "new", label: "New" },
  { code: "attempting_contact", label: "Attempting Contact" },
  { code: "contacted", label: "Contacted" },
  { code: "nurturing", label: "Nurturing" },
  { code: "qualification", label: "Qualification" },
]);

// An open lead with no activity for this many days is shown as stale, and a
// lead this long in one stage as stuck. Both are calculated, never stored.
export const LEAD_STALE_DAYS = 7;

export const LEAD_STATUSES = Object.freeze([
  { code: "open", label: "Open" },
  { code: "qualified", label: "Qualified" },
  { code: "disqualified", label: "Disqualified" },
  { code: "converted", label: "Converted" },
]);

export const LEAD_PRIORITIES = Object.freeze(["low", "medium", "high"]);
export const LEAD_RATINGS = Object.freeze(["cold", "warm", "hot"]);
// Qualification status is derived from the lead's status and whether
// qualification has started; it is never stored on its own.
export const LEAD_QUALIFICATION_STATUSES = Object.freeze([
  { code: "not_started", label: "Not Qualified Yet" },
  { code: "in_progress", label: "In Qualification" },
  { code: "qualified", label: "Qualified" },
  { code: "disqualified", label: "Disqualified" },
]);

export const LEAD_NEED_STATUSES = Object.freeze([
  { code: "yes", label: "Yes" },
  { code: "no", label: "No" },
  { code: "unknown", label: "Unknown" },
]);

export const LEAD_BUDGET_STATUSES = Object.freeze([
  { code: "confirmed", label: "Confirmed" },
  { code: "likely", label: "Likely" },
  { code: "unknown", label: "Unknown" },
  { code: "no_budget", label: "No Budget" },
]);

export const LEAD_AUTHORITY_STATUSES = Object.freeze([
  { code: "decision_maker", label: "Decision Maker" },
  { code: "influencer", label: "Influencer" },
  { code: "unknown", label: "Unknown" },
  { code: "no_authority", label: "No Authority" },
]);

export const LEAD_PURCHASE_TIMEFRAMES = Object.freeze([
  { code: "immediate", label: "Immediate" },
  { code: "within_1_month", label: "Within 1 month" },
  { code: "within_3_months", label: "1–3 months" },
  { code: "within_6_months", label: "3–6 months" },
  { code: "within_12_months", label: "6–12 months" },
  { code: "later", label: "More than 12 months" },
  { code: "unknown", label: "Unknown" },
]);

export const LEAD_DISQUALIFICATION_REASONS = Object.freeze([
  { code: "no_requirement", label: "No Requirement" },
  { code: "no_budget", label: "No Budget" },
  { code: "not_decision_maker", label: "No Authority" },
  { code: "timing_not_suitable", label: "Timing Not Suitable" },
  { code: "not_interested", label: "Not Interested" },
  { code: "unable_to_contact", label: "Unable to Contact" },
  { code: "invalid_contact", label: "Invalid Lead" },
  { code: "duplicate", label: "Duplicate" },
  { code: "competitor_selected", label: "Competitor Selected" },
  { code: "bad_fit", label: "Poor Fit" },
  { code: "other", label: "Other" },
]);

// Seeded for every organization; administrators can rename, add and
// deactivate them.
export const DEFAULT_LEAD_SOURCES = Object.freeze([
  { code: "website", name: "Website", channel: "website" },
  { code: "referral", name: "Referral", channel: "referral" },
  { code: "phone", name: "Phone", channel: "phone" },
  { code: "email", name: "Email", channel: "email" },
  { code: "social_media", name: "Social Media", channel: "social" },
  { code: "advertisement", name: "Advertisement", channel: "advertising" },
  { code: "event", name: "Event", channel: "event" },
  { code: "partner", name: "Partner", channel: "partner" },
  { code: "outbound_sales", name: "Outbound Sales", channel: "other" },
  { code: "existing_customer", name: "Existing Customer", channel: "other" },
  { code: "other", name: "Other", channel: "other" },
]);

// Activity types a salesperson can log against a lead.
export const LEAD_ACTIVITY_TYPES = Object.freeze([
  { code: "call", label: "Call" },
  { code: "email", label: "Email" },
  { code: "meeting", label: "Meeting" },
  { code: "other", label: "General activity" },
]);

export const LEAD_FOLLOW_UP_TYPES = Object.freeze(["call", "email", "meeting", "task", "other"]);

export const LEAD_PERMISSIONS = Object.freeze({
  view: "crm.leads.view",
  viewAll: "crm.leads.view_all",
  viewSensitive: "crm.leads.view_sensitive",
  create: "crm.leads.create",
  edit: "crm.leads.edit",
  delete: "crm.leads.delete",
  assign: "crm.leads.assign",
  reassign: "crm.leads.reassign",
  import: "crm.leads.import",
  export: "crm.leads.export",
  qualify: "crm.leads.qualify",
  disqualify: "crm.leads.disqualify",
  reopen: "crm.leads.reopen",
  convert: "crm.leads.convert",
  changeStage: "crm.leads.change_stage",
  manageStages: "crm.leads.manage_stages",
  overrideQualification: "crm.leads.override_qualification",
  assignSelf: "crm.leads.assign_self",
  bulkAssign: "crm.leads.bulk_assign",
  assignAcrossTeams: "crm.leads.assign_across_teams",
  manageAssignmentRules: "crm.leads.manage_assignment_rules",
});

// How a lead got its current owner or team.
export const LEAD_ASSIGNMENT_METHODS = Object.freeze([
  { code: "manual", label: "Manual" },
  { code: "self", label: "Assigned to self" },
  { code: "rule", label: "Automatic rule" },
  { code: "round_robin", label: "Round-robin" },
  { code: "fallback", label: "Default queue" },
  { code: "bulk", label: "Bulk assignment" },
  { code: "import", label: "Import" },
  { code: "creator", label: "Creator" },
  { code: "transfer", label: "Transfer" },
  { code: "integration", label: "Web form / integration" },
]);

// The lead fields an assignment rule can test, and how.
export const LEAD_RULE_FIELDS = Object.freeze([
  { code: "sourceId", label: "Lead source", column: "source_id", kind: "source" },
  { code: "countryCode", label: "Country", column: "country_code", kind: "country" },
  { code: "state", label: "State", column: "state", kind: "text" },
  { code: "city", label: "City", column: "city", kind: "text" },
  { code: "productInterest", label: "Product / service interest", column: "product_interest", kind: "text" },
  { code: "industry", label: "Industry", column: "industry", kind: "text" },
  { code: "sourceDetail", label: "Campaign / source detail", column: "source_detail", kind: "text" },
  { code: "companyName", label: "Company", column: "company_name", kind: "text" },
  { code: "priority", label: "Priority", column: "priority", kind: "choice" },
  { code: "rating", label: "Rating", column: "rating", kind: "choice" },
]);

export const LEAD_RULE_OPERATORS = Object.freeze([
  { code: "equals", label: "equals" },
  { code: "not_equals", label: "does not equal" },
  { code: "contains", label: "contains" },
  { code: "is_empty", label: "is empty" },
  { code: "is_not_empty", label: "is not empty" },
]);

export const leadAssignmentMethodLabel = (code) => LEAD_ASSIGNMENT_METHODS.find((entry) => entry.code === code)?.label ?? code;

export const LEAD_NUMBER_DOCUMENT_TYPE = "crm_lead";

const label = (list) => new Map(list.map((entry) => [entry.code, entry.label]));
const STATUS_LABELS = label(LEAD_STATUSES);
const REASON_LABELS = label(LEAD_DISQUALIFICATION_REASONS);

export const leadStatusLabel = (code) => STATUS_LABELS.get(code) ?? code;
export const leadDisqualificationReasonLabel = (code) => REASON_LABELS.get(code) ?? code;
export const leadQualificationStatusLabel = (code) => LEAD_QUALIFICATION_STATUSES.find((entry) => entry.code === code)?.label ?? code;
