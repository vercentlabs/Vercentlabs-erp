// Won / Lost Reasons: why a deal ended the way it did. The opportunity's
// status says what happened (won or lost); the close reason says why.
//
// Each reason is one of the two kinds and carries its own small rules:
//   requiresNotes        a short explanation is required (always for Other)
//   capturesCompetitor   the dialog asks who the deal went to (or was won against)
//   requiresCompetitor   that name is required
//   offersFollowUp       offer to schedule a future follow-up (the deal may come back)
//   linksDuplicate       ask for the original opportunity this one duplicates
export const CLOSE_REASON_PERMISSIONS = Object.freeze({
  manage: "crm.opportunities.manage_close_reasons",
  correct: "crm.opportunities.edit_close_reason",
});

export const CLOSE_OUTCOMES = Object.freeze(["won", "lost"]);

// The reporting buckets a reason belongs to.
export const CLOSE_REASON_CATEGORIES = Object.freeze([
  { code: "price", label: "Commercial" },
  { code: "competition", label: "Competition" },
  { code: "fit", label: "Product and fit" },
  { code: "budget", label: "Budget" },
  { code: "timing", label: "Timing" },
  { code: "no_response", label: "Customer" },
  { code: "duplicate", label: "Duplicate" },
  { code: "other", label: "Other" },
]);

const reason = (code, name, category, outcome, rules = {}) => Object.freeze({
  code, name, category, outcome,
  requiresNotes: false, capturesCompetitor: false, requiresCompetitor: false, offersFollowUp: false, linksDuplicate: false, ...rules,
});

// The locked default lists, seeded for every organization.
export const DEFAULT_CLOSE_REASONS = Object.freeze([
  reason("best_fit", "Best Product / Solution Fit", "fit", "won"),
  reason("better_pricing", "Better Pricing / Commercials", "price", "won"),
  reason("strong_relationship", "Strong Customer Relationship", "other", "won"),
  reason("better_features", "Better Features / Capabilities", "fit", "won"),
  reason("faster_implementation", "Faster Implementation", "timing", "won"),
  reason("existing_customer", "Existing Customer / Expansion", "other", "won"),
  reason("strong_support", "Strong Support / Service", "other", "won"),
  reason("preferred_vendor", "Preferred Vendor", "other", "won"),
  reason("competitor_weakness", "Competitor Weakness", "competition", "won", { capturesCompetitor: true }),
  reason("won_other", "Other", "other", "won", { requiresNotes: true }),
  reason("price_too_high", "Price Too High", "price", "lost"),
  reason("competitor_selected", "Competitor Selected", "competition", "lost", { capturesCompetitor: true, requiresCompetitor: true }),
  reason("no_budget", "No Budget", "budget", "lost", { offersFollowUp: true }),
  reason("project_cancelled", "Project Cancelled", "other", "lost"),
  reason("decision_delayed", "Decision Delayed", "timing", "lost", { offersFollowUp: true }),
  reason("no_decision", "No Decision", "timing", "lost"),
  reason("requirements_not_met", "Requirements Not Met", "fit", "lost"),
  reason("product_gap", "Product / Feature Gap", "fit", "lost"),
  reason("implementation_concerns", "Implementation Concerns", "fit", "lost"),
  reason("customer_unresponsive", "Customer Unresponsive", "no_response", "lost"),
  reason("poor_fit", "Poor Fit", "fit", "lost"),
  reason("timing_not_suitable", "Timing Not Suitable", "timing", "lost", { offersFollowUp: true }),
  reason("internal_decision", "Internal Customer Decision", "other", "lost"),
  reason("duplicate_opportunity", "Duplicate Opportunity", "duplicate", "lost", { linksDuplicate: true }),
  reason("other", "Other", "other", "lost", { requiresNotes: true }),
]);

// Groupings offered by the win / loss report.
export const CLOSE_REPORT_GROUPS = Object.freeze({
  reason: "Reason",
  owner: "Owner",
  team: "Team",
  source: "Lead source",
  product: "Product",
  account: "Account",
  industry: "Industry",
  stage: "Final stage",
  month: "Close month",
});
