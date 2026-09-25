// The base "can open this module at all" permission for every business
// module in packages/shared-types' ERP_MODULE_CATALOG. This is the one
// canonical map — services/api's module-entitlement pipeline and the Shared
// Access boundary both read it; nothing else may define its own copy.
// packages/permissions/tests/catalog-integrity.test.mjs proves every key is a
// catalogue module and every value is a registered permission.
export const MODULE_ACCESS_PERMISSIONS = Object.freeze({
  crm: "crm.view",
  sales: "sales.view",
  accounting: "accounting.view",
  procurement: "procurement.view",
  stock: "stock.view",
  manufacturing: "manufacturing.view",
  projects: "projects.view",
  assets: "assets.view",
  "point-of-sale": "pos.view",
  quality: "quality.view",
  support: "support.view",
  "hr-payroll": "hr_payroll.view",
});

// Roles whose membership grants organization-wide company/branch scope and
// bypasses per-permission checks (organization_owner) — the same slugs
// session resolution's SQL predicate uses. Kept here, beside the role
// templates they describe, so no module invents its own list.
export const UNRESTRICTED_SCOPE_ROLE_SLUGS = Object.freeze(["organization_owner", "system_administrator"]);
export const PERMISSION_BYPASS_ROLE_SLUGS = Object.freeze(["organization_owner"]);

export function moduleAccessPermission(moduleKey) {
  return Object.prototype.hasOwnProperty.call(MODULE_ACCESS_PERMISSIONS, moduleKey)
    ? MODULE_ACCESS_PERMISSIONS[moduleKey]
    : null;
}
