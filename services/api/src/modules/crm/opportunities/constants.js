// The fixed vocabulary of an opportunity. Stage answers "where is this deal
// in the sales process?" and is the organization's configurable list of
// sales stages; status answers "what is the outcome?" and is fixed here.
export const OPPORTUNITY_STATUSES = Object.freeze([
  { code: "open", label: "Open" },
  { code: "won", label: "Won" },
  { code: "lost", label: "Lost" },
]);

export const OPPORTUNITY_PRIORITIES = Object.freeze([
  { code: "low", label: "Low" },
  { code: "medium", label: "Medium" },
  { code: "high", label: "High" },
]);

// What a stakeholder is to the deal.
export const OPPORTUNITY_CONTACT_ROLES = Object.freeze([
  { code: "decision_maker", label: "Decision maker" },
  { code: "economic_buyer", label: "Economic buyer" },
  { code: "champion", label: "Champion" },
  { code: "influencer", label: "Influencer" },
  { code: "technical", label: "Technical evaluator" },
  { code: "user", label: "User" },
  { code: "procurement", label: "Procurement" },
  { code: "legal", label: "Legal" },
  { code: "blocker", label: "Blocker" },
  { code: "other", label: "Other" },
]);

// Seeded for every organization; administrators can rename, add and
// deactivate them under CRM settings. `category` is the reporting bucket.
export const DEFAULT_LOST_REASONS = Object.freeze([
  { code: "price_too_high", name: "Price Too High", category: "price" },
  { code: "competitor_selected", name: "Competitor Selected", category: "competition" },
  { code: "no_budget", name: "No Budget", category: "budget" },
  { code: "project_cancelled", name: "Project Cancelled", category: "other" },
  { code: "decision_delayed", name: "Decision Delayed", category: "timing" },
  { code: "requirements_not_met", name: "Requirements Not Met", category: "fit" },
  { code: "customer_unresponsive", name: "Customer Unresponsive", category: "no_response" },
  { code: "poor_fit", name: "Poor Fit", category: "fit" },
  { code: "internal_decision", name: "Internal Decision", category: "other" },
  { code: "duplicate_opportunity", name: "Duplicate Opportunity", category: "duplicate" },
  { code: "other", name: "Other", category: "other" },
]);

// Activity types a salesperson can log against an opportunity. A demo is a
// meeting to the activity table; the subject says it was a demo.
export const OPPORTUNITY_ACTIVITY_TYPES = Object.freeze([
  { code: "call", label: "Call", activityType: "call" },
  { code: "email", label: "Email", activityType: "email" },
  { code: "meeting", label: "Meeting", activityType: "meeting" },
  { code: "demo", label: "Demo", activityType: "meeting" },
  { code: "other", label: "General activity", activityType: "other" },
]);

export const OPPORTUNITY_FOLLOW_UP_TYPES = Object.freeze(["call", "email", "meeting", "task", "other"]);

export const OPPORTUNITY_PERMISSIONS = Object.freeze({
  view: "crm.opportunities.view",
  viewAll: "crm.opportunities.view_all",
  create: "crm.opportunities.create",
  edit: "crm.opportunities.edit",
  assign: "crm.opportunities.assign",
  reassign: "crm.opportunities.reassign",
  changeStage: "crm.opportunities.change_stage",
  createQuotation: "crm.opportunities.create_quotation",
  markWon: "crm.opportunities.mark_won",
  markLost: "crm.opportunities.mark_lost",
  reopen: "crm.opportunities.reopen",
  delete: "crm.opportunities.delete",
  export: "crm.opportunities.export",
});

export const OPPORTUNITY_NUMBER_DOCUMENT_TYPE = "crm_opportunity";

// An open opportunity with no activity for this many days is shown as stale.
// Stale and overdue are calculated, never stored as a status.
export const OPPORTUNITY_STALE_DAYS = 14;

const labels = (list) => new Map(list.map((entry) => [entry.code, entry.label]));
const STATUS_LABELS = labels(OPPORTUNITY_STATUSES);
const PRIORITY_LABELS = labels(OPPORTUNITY_PRIORITIES);

export const opportunityStatusLabel = (code) => STATUS_LABELS.get(code) ?? code;
export const opportunityPriorityLabel = (code) => PRIORITY_LABELS.get(code) ?? code;
