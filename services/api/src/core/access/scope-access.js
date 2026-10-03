// Organization scope. Record-level scope (CRM owner/team, POS store/terminal,
// HR self/manager, Support queue, Projects membership, …) stays in each
// business module and runs after this check.
import { ACCESS_ERROR_CODES } from "./errors.js";

// Returns null when allowed, otherwise a denial decision fragment.
export function checkOrganizationScope(principal, organizationId) {
  if (organizationId === undefined || organizationId === null) return null;
  if (organizationId === principal.organizationId) return null;
  return { code: ACCESS_ERROR_CODES.SCOPE_DENIED, reason: "organization" };
}
