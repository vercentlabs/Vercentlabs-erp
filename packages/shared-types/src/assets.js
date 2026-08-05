export const ASSET_RESOURCE_KEYS = Object.freeze([
  "assets",
  "categories",
  "assignments",
  "transfers",
  "maintenance-plans",
  "maintenance-orders",
  "inspections",
  "depreciation-runs",
  "disposals",
  "audit-events",
]);

export const ASSET_STATUSES = Object.freeze([
  "draft",
  "available",
  "assigned",
  "in_maintenance",
  "retired",
  "disposed",
]);

export const ASSET_MAINTENANCE_STATUSES = Object.freeze([
  "planned",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

export const ASSET_DISPOSAL_METHODS = Object.freeze([
  "sale",
  "scrap",
  "write_off",
  "donation",
  "return_to_vendor",
]);
