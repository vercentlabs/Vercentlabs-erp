// The Shared Access authorization facade.
//
//   authentication → MFA assurance → active membership/organization
//   → module (released → enabled → entitled → permitted)
//   → permission(s) → organization scope → company scope → branch scope
//   → domain record policy (owned by the business module, passed in)
//
// authorize() is pure: it decides from a principal/snapshot already
// resolved on the server. It never reads request input for identity and
// never performs I/O, so it is cheap to call repeatedly within a request.
// Domain-specific record rules (CRM owner/team, POS store/terminal, HR
// self/manager, Support queue, Projects membership, …) are NOT implemented
// here — modules supply them as `recordPolicy` or run them after this.
import { ACCESS_ERROR_CODES, accessStatusFor, denialToError } from "./errors.js";
import { checkSnapshotModuleAccess } from "./module-access.js";
import { principalHasPermission } from "./principal.js";
import { checkBranchScope, checkCompanyScope, checkOrganizationScope } from "./scope-access.js";

function deny(fragment, { action, conceal = false, module, permission } = {}) {
  return Object.freeze({
    allowed: false,
    code: fragment.code,
    status: accessStatusFor(conceal ? ACCESS_ERROR_CODES.RESOURCE_NOT_FOUND : fragment.code),
    module: fragment.module ?? module ?? null,
    permission: fragment.permission ?? permission ?? null,
    action: action ?? null,
    reason: fragment.reason ?? null,
    conceal,
  });
}

function requiredPermissions(permission, permissions) {
  const list = [];
  if (permission) list.push(permission);
  if (Array.isArray(permissions)) list.push(...permissions);
  return list;
}

export function authorize({ principal, snapshot, module, permission, permissions, action, resource, context, recordPolicy, selfService = false } = {}) {
  const actor = principal ?? snapshot?.principal ?? null;
  const meta = { action, module };
  if (!actor || !actor.userId) return deny({ code: ACCESS_ERROR_CODES.AUTH_REQUIRED }, meta);
  if (!actor.assurance?.mfaSatisfied) return deny({ code: ACCESS_ERROR_CODES.AUTH_MFA_REQUIRED }, meta);
  if (!actor.organizationId) return deny({ code: ACCESS_ERROR_CODES.MEMBERSHIP_INACTIVE }, meta);

  if (module) {
    if (!snapshot) throw new TypeError("authorize(): module checks require a WorkspaceAccessSnapshot.");
    const moduleDenial = checkSnapshotModuleAccess(snapshot, module);
    // Self-service (an employee's own HR records, a portal customer's own
    // tickets): the module must still be released, enabled and entitled, but
    // the module view permission is waived — the domain scopes every read and
    // write to the caller's own records.
    const waived = selfService && moduleDenial?.reason === "not_permitted";
    if (moduleDenial && !waived) return deny(moduleDenial, meta);
  }

  for (const key of requiredPermissions(permission, permissions)) {
    if (!principalHasPermission(actor, key)) return deny({ code: ACCESS_ERROR_CODES.PERMISSION_DENIED, permission: key }, meta);
  }

  // A resource the caller addressed directly (by id) is concealed on a
  // scope denial: 404, never proof that it exists in another tenant/scope.
  const conceal = Boolean(resource);
  const organizationDenial = checkOrganizationScope(actor, resource?.organizationId);
  if (organizationDenial) return deny(organizationDenial, { ...meta, conceal });

  const companyId = resource?.companyId ?? context?.companyId ?? null;
  const branchId = resource?.branchId ?? context?.branchId ?? null;
  if ((companyId || branchId) && !actor.companyScope.unrestricted && !actor.companyScope.resolved) {
    throw new TypeError("authorize(): company/branch scope checks require a principal from a WorkspaceAccessSnapshot.");
  }
  const companyDenial = checkCompanyScope(actor, companyId);
  if (companyDenial) return deny(companyDenial, { ...meta, conceal });
  const branchDenial = checkBranchScope(actor, branchId, { companyId, branches: snapshot?.branches });
  if (branchDenial) return deny(branchDenial, { ...meta, conceal });

  if (recordPolicy) {
    const recordDenial = recordPolicy({ principal: actor, snapshot, resource, context, action });
    if (recordDenial) return deny(recordDenial, { ...meta, conceal: recordDenial.conceal ?? conceal });
  }

  return Object.freeze({ allowed: true, principal: actor, module: module ?? null, action: action ?? null });
}

export function requireAuthorization(input) {
  const decision = authorize(input);
  if (!decision.allowed) throw denialToError(decision);
  return decision.principal;
}
