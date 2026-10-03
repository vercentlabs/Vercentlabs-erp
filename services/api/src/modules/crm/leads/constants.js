// The fixed vocabulary of a lead. Stage answers "where are we in the
// process?"; status answers "what is the outcome of this record?". They are
// separate columns and change through separate operations.
export const LEAD_STAGES = Object.freeze([
  { code: "new", label: "New" },
  { code: "attempting_contact", label: "Attempting Contact" },
  { code: "contacted", label: "Contacted" },
  { code: "nurturing", label: "Nurturing" },
  { code: "ready_to_qualify", label: "Ready to Qualify" },
]);

export const LEAD_STATUSES = Object.freeze([
  { code: "open", label: "Open" },
  { code: "qualified", label: "Qualified" },
  { code: "disqualified", label: "Disqualified" },
  { code: "converted", label: "Converted" },
]);

export const LEAD_PRIORITIES = Object.freeze(["low", "medium", "high"]);
export const LEAD_RATINGS = Object.freeze(["cold", "warm", "hot"]);
export const LEAD_TRI_STATE = Object.freeze(["yes", "no", "unknown"]);
export const LEAD_BUDGET_STATUSES = Object.freeze(["known", "unknown"]);

export const LEAD_PURCHASE_TIMEFRAMES = Object.freeze([
  { code: "immediate", label: "Immediately" },
  { code: "within_1_month", label: "Within 1 month" },
  { code: "within_3_months", label: "Within 3 months" },
  { code: "within_6_months", label: "Within 6 months" },
  { code: "within_12_months", label: "Within 12 months" },
  { code: "later", label: "Later than 12 months" },
  { code: "unknown", label: "Unknown" },
]);

export const LEAD_DISQUALIFICATION_REASONS = Object.freeze([
  { code: "not_interested", label: "Not interested" },
  { code: "no_requirement", label: "No requirement" },
  { code: "no_budget", label: "No budget" },
  { code: "not_decision_maker", label: "Not decision maker" },
  { code: "bad_fit", label: "Bad fit" },
  { code: "duplicate", label: "Duplicate" },
  { code: "invalid_contact", label: "Invalid contact information" },
  { code: "unable_to_contact", label: "Unable to contact" },
  { code: "competitor_selected", label: "Competitor selected" },
  { code: "timing_not_suitable", label: "Timing not suitable" },
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
});

export const LEAD_NUMBER_DOCUMENT_TYPE = "crm_lead";

const label = (list) => new Map(list.map((entry) => [entry.code, entry.label]));
const STAGE_LABELS = label(LEAD_STAGES);
const STATUS_LABELS = label(LEAD_STATUSES);
const REASON_LABELS = label(LEAD_DISQUALIFICATION_REASONS);

export const leadStageLabel = (code) => STAGE_LABELS.get(code) ?? code;
export const leadStatusLabel = (code) => STATUS_LABELS.get(code) ?? code;
export const leadDisqualificationReasonLabel = (code) => REASON_LABELS.get(code) ?? code;
