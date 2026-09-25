// Stable Shared Access error semantics. Every access denial produced by the
// Shared Access boundary carries one of these codes; clients, tests and logs
// key on the code, never on the message text.
//
// Existing per-capability error classes (ModuleAccessError,
// PermissionDeniedError, ContextSwitchError, AccessAdministrationError, …)
// keep their historical codes for compatibility; LEGACY_ACCESS_CODE_ALIASES
// maps them onto the canonical vocabulary for logging/metrics.
export const ACCESS_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_MFA_REQUIRED: "AUTH_MFA_REQUIRED",
  MEMBERSHIP_INACTIVE: "MEMBERSHIP_INACTIVE",
  MODULE_UNAVAILABLE: "MODULE_UNAVAILABLE",
  MODULE_DISABLED: "MODULE_DISABLED",
  MODULE_NOT_ENTITLED: "MODULE_NOT_ENTITLED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SCOPE_DENIED: "SCOPE_DENIED",
  FIELD_ACCESS_DENIED: "FIELD_ACCESS_DENIED",
  SOD_CONFLICT: "SOD_CONFLICT",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
});

const STATUS_BY_CODE = Object.freeze({
  AUTH_REQUIRED: 401,
  AUTH_MFA_REQUIRED: 403,
  MEMBERSHIP_INACTIVE: 403,
  MODULE_UNAVAILABLE: 404,
  MODULE_DISABLED: 403,
  MODULE_NOT_ENTITLED: 403,
  PERMISSION_DENIED: 403,
  SCOPE_DENIED: 403,
  FIELD_ACCESS_DENIED: 403,
  SOD_CONFLICT: 409,
  RESOURCE_NOT_FOUND: 404,
});

const DEFAULT_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "Authentication is required.",
  AUTH_MFA_REQUIRED: "Multi-factor verification is required for this session.",
  MEMBERSHIP_INACTIVE: "An active organisation membership is required.",
  MODULE_UNAVAILABLE: "This module is not available.",
  MODULE_DISABLED: "This module is not enabled for this workspace.",
  MODULE_NOT_ENTITLED: "This module is not included in the current plan.",
  PERMISSION_DENIED: "You do not have permission to perform this action.",
  SCOPE_DENIED: "This record is outside your access scope.",
  FIELD_ACCESS_DENIED: "You do not have permission to change one or more of these fields.",
  SOD_CONFLICT: "This combination of duties is not allowed.",
  RESOURCE_NOT_FOUND: "The requested record was not found.",
});

export const LEGACY_ACCESS_CODE_ALIASES = Object.freeze({
  MODULE_NOT_AVAILABLE: ACCESS_ERROR_CODES.MODULE_UNAVAILABLE,
  MODULE_NOT_PERMITTED: ACCESS_ERROR_CODES.PERMISSION_DENIED,
  COMPANY_ACCESS_DENIED: ACCESS_ERROR_CODES.SCOPE_DENIED,
  BRANCH_ACCESS_DENIED: ACCESS_ERROR_CODES.SCOPE_DENIED,
  AUTH_NO_WORKSPACE: ACCESS_ERROR_CODES.MEMBERSHIP_INACTIVE,
  AUTH_NO_ORGANIZATION: ACCESS_ERROR_CODES.MEMBERSHIP_INACTIVE,
});

export function canonicalAccessCode(code) {
  if (!code) return null;
  if (Object.prototype.hasOwnProperty.call(ACCESS_ERROR_CODES, code)) return code;
  return LEGACY_ACCESS_CODE_ALIASES[code] ?? null;
}

export function accessStatusFor(code) {
  return STATUS_BY_CODE[code] ?? 403;
}

export class AccessDeniedError extends Error {
  constructor(code, { message, module, permission, action, reason, conceal = false } = {}) {
    // Concealment: a direct-object access outside the caller's scope is
    // reported as "not found" so the response never proves the object
    // exists. The original code stays on `deniedCode` for audit/logging.
    const effectiveCode = conceal ? ACCESS_ERROR_CODES.RESOURCE_NOT_FOUND : code;
    super(message ?? DEFAULT_MESSAGES[effectiveCode] ?? DEFAULT_MESSAGES.PERMISSION_DENIED);
    this.name = "AccessDeniedError";
    this.code = effectiveCode;
    this.deniedCode = code;
    this.status = accessStatusFor(effectiveCode);
    this.module = module ?? null;
    this.permission = permission ?? null;
    this.action = action ?? null;
    this.reason = reason ?? null;
  }
}

export function isAccessDeniedError(error) {
  return error instanceof AccessDeniedError;
}

export function denialToError(decision) {
  return new AccessDeniedError(decision.code, {
    module: decision.module,
    permission: decision.permission,
    action: decision.action,
    reason: decision.reason,
    conceal: decision.conceal,
  });
}
