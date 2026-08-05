export const QUALITY_RESOURCE_KEYS = Object.freeze([
  "plans",
  "inspection-points",
  "inspections",
  "inspection-results",
  "holds",
  "non-conformances",
  "capa",
  "supplier-quality",
  "audits",
  "traceability",
]);

export const QUALITY_INSPECTION_STATUSES = Object.freeze([
  "draft",
  "in_progress",
  "passed",
  "failed",
  "conditionally_accepted",
  "cancelled",
]);

export const QUALITY_NONCONFORMANCE_STATUSES = Object.freeze([
  "open",
  "under_review",
  "contained",
  "corrective_action",
  "verified",
  "closed",
  "cancelled",
]);

export const QUALITY_DISPOSITIONS = Object.freeze([
  "accept",
  "accept_with_deviation",
  "rework",
  "repair",
  "return_to_supplier",
  "scrap",
  "use_as_is",
]);
