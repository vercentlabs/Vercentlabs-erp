// Organization / company / branch scope. These are the SHARED scope rules;
// record-level scope (CRM owner/team, POS store/terminal, HR self/manager,
// Support queue, Projects membership, …) stays in each business module and
// runs after these checks.
import { ACCESS_ERROR_CODES } from "./errors.js";

// Returns null when allowed, otherwise a denial decision fragment.
export function checkOrganizationScope(principal, organizationId) {
  if (organizationId === undefined || organizationId === null) return null;
  if (organizationId === principal.organizationId) return null;
  return { code: ACCESS_ERROR_CODES.SCOPE_DENIED, reason: "organization" };
}

export function canAccessCompany(principal, companyId) {
  if (!companyId) return true;
  if (principal.companyScope.unrestricted) return true;
  return principal.companyScope.companyIds.includes(companyId);
}

export function canAccessBranch(principal, branchId, { companyId, branches } = {}) {
  if (!branchId) return true;
  if (branches && companyId) {
    const branch = branches.find((entry) => entry.id === branchId);
    if (!branch || branch.companyId !== companyId) return false;
  }
  if (principal.companyScope.unrestricted) return true;
  return principal.companyScope.branchIds.includes(branchId);
}

export function checkCompanyScope(principal, companyId) {
  if (canAccessCompany(principal, companyId)) return null;
  return { code: ACCESS_ERROR_CODES.SCOPE_DENIED, reason: "company" };
}

export function checkBranchScope(principal, branchId, options) {
  if (canAccessBranch(principal, branchId, options)) return null;
  return { code: ACCESS_ERROR_CODES.SCOPE_DENIED, reason: "branch" };
}
