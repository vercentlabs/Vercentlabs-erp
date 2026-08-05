export const MANUFACTURING_RESOURCE_KEYS = Object.freeze([
  "boms",
  "routings",
  "work-centers",
  "work-orders",
  "operations",
  "material-requirements",
  "production-postings",
  "scrap",
  "planning-runs",
]);

export const BOM_STATUSES = Object.freeze([
  "draft",
  "active",
  "inactive",
  "obsolete",
]);
export const WORK_ORDER_STATUSES = Object.freeze([
  "draft",
  "planned",
  "released",
  "in_progress",
  "completed",
  "cancelled",
]);
export const OPERATION_STATUSES = Object.freeze([
  "pending",
  "ready",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
]);
export const MANUFACTURING_POSTING_TYPES = Object.freeze([
  "material_issue",
  "material_return",
  "production_receipt",
  "scrap",
]);
