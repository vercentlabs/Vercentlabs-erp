import type { ModuleAccess } from "./module-entitlements.js";

export type AccessErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_MFA_REQUIRED"
  | "MEMBERSHIP_INACTIVE"
  | "MODULE_UNAVAILABLE"
  | "MODULE_DISABLED"
  | "MODULE_NOT_ENTITLED"
  | "PERMISSION_DENIED"
  | "SCOPE_DENIED"
  | "FIELD_ACCESS_DENIED"
  | "SOD_CONFLICT"
  | "RESOURCE_NOT_FOUND";

export declare const ACCESS_ERROR_CODES: Readonly<{ [K in AccessErrorCode]: K }>;
export declare const LEGACY_ACCESS_CODE_ALIASES: Readonly<Record<string, AccessErrorCode>>;
export declare function canonicalAccessCode(code: string | null | undefined): AccessErrorCode | null;
export declare function accessStatusFor(code: string): number;

export declare class AccessDeniedError extends Error {
  constructor(
    code: AccessErrorCode,
    options?: { message?: string; module?: string; permission?: string; action?: string; reason?: string; conceal?: boolean },
  );
  readonly status: number;
  readonly code: AccessErrorCode;
  readonly deniedCode: AccessErrorCode;
  readonly module: string | null;
  readonly permission: string | null;
  readonly action: string | null;
  readonly reason: string | null;
}
export declare function isAccessDeniedError(error: unknown): error is AccessDeniedError;

/** The authenticated actor, reduced to security-relevant facts. Server-resolved only. */
export type AccessPrincipal = Readonly<{
  kind: "user";
  userId: string;
  sessionId: string | null;
  organizationId: string;
  roleSlugs: readonly string[];
  permissions: readonly string[];
  permissionBypass: boolean;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  companyScope: Readonly<{
    unrestricted: boolean;
    resolved: boolean;
    companyIds: readonly string[];
    branchIds: readonly string[];
  }>;
  locale: string | null;
  timezone: string | null;
  assurance: Readonly<{
    emailVerified: boolean;
    mfaEnrolled: boolean;
    mfaPolicyRequired: boolean;
    mfaVerified: boolean;
    mfaSatisfied: boolean;
  }>;
}>;

/** Minimal session contract a principal is built from (resolveSessionContext's result). */
export type AccessSessionInput = {
  userId: string;
  organizationId: string | null;
  sessionId?: string | null;
  roleSlugs?: readonly string[];
  permissions?: readonly string[];
  activeCompanyId?: string | null;
  activeBranchId?: string | null;
  locale?: string | null;
  timezone?: string | null;
  emailVerified?: boolean;
  mfaEnrolled?: boolean;
  mfaPolicyRequired?: boolean;
  mfaVerified?: boolean;
};

export declare const CLIENT_TENANT_IDENTITY_KEYS: readonly string[];
export declare function isUuid(value: unknown): value is string;
export declare function permissionUnion(roleGrants: ReadonlyArray<{ permissions?: readonly string[] }>): readonly string[];
export declare function mfaAssuranceSatisfied(session: AccessSessionInput): boolean;
export declare function createAccessPrincipal(
  session: AccessSessionInput | null | undefined,
  scope?: { companyIds?: readonly string[]; branchIds?: readonly string[] },
): AccessPrincipal;
export declare function principalHasPermission(principal: AccessPrincipal | null | undefined, permission: string): boolean;
export declare function assertNoClientTenantOverride(input: unknown, principal: AccessPrincipal): void;
export declare function withoutClientTenantIdentity<T>(input: T): T;
export declare function principalToDomainContext(principal: AccessPrincipal): {
  organizationId: string;
  userId: string;
  roleSlugs: string[];
  permissions: string[];
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies: boolean;
};

export type AccessSubscription = Readonly<{
  status: string | null;
  planCode: string | null;
  writeAccess: boolean;
  enforcementMode: string | null;
  seats: unknown;
  seatOverage: unknown;
}>;

export type WorkspaceAccessSnapshot = Readonly<{
  principal: AccessPrincipal;
  subscription: AccessSubscription | null;
  modules: readonly ModuleAccess[];
  enabledModules: readonly string[];
  entitledModules: readonly string[];
  accessibleModules: readonly string[];
  companies: ReadonlyArray<Readonly<{ id: string; name: string | null }>>;
  branches: ReadonlyArray<Readonly<{ id: string; name: string | null; companyId: string }>>;
  generatedAt: string;
}>;

export declare function assembleWorkspaceAccessSnapshot(input: {
  session: AccessSessionInput;
  companies: ReadonlyArray<{ id: string; name?: string | null; branches?: ReadonlyArray<{ id: string; name?: string | null; company_id?: string; companyId?: string }> }>;
  enabledModuleKeys: ReadonlySet<string> | null;
  billingSummary: { modules?: readonly string[]; enforcementMode?: string; [key: string]: unknown } | null;
  now?: Date;
}): WorkspaceAccessSnapshot;
export declare function buildWorkspaceAccessSnapshot(
  client: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> },
  session: AccessSessionInput,
  options?: { env?: Record<string, string | undefined>; now?: Date },
): Promise<WorkspaceAccessSnapshot>;

export type AccessDenialFragment = { code: AccessErrorCode; reason?: string | null; module?: string | null; permission?: string | null; conceal?: boolean };

export declare const MODULE_ACCESS_PERMISSIONS: Readonly<Record<string, string>>;
export declare function moduleAccessPermission(moduleKey: string): string | null;
export declare function moduleAccessDenialCode(access: ModuleAccess | null): AccessErrorCode | null;
export declare function snapshotModuleAccess(snapshot: WorkspaceAccessSnapshot, moduleKey: string): ModuleAccess | null;
export declare function checkSnapshotModuleAccess(snapshot: WorkspaceAccessSnapshot, moduleKey: string): AccessDenialFragment | null;

export declare function checkOrganizationScope(principal: AccessPrincipal, organizationId: string | null | undefined): AccessDenialFragment | null;
export declare function canAccessCompany(principal: AccessPrincipal, companyId: string | null | undefined): boolean;
export declare function canAccessBranch(
  principal: AccessPrincipal,
  branchId: string | null | undefined,
  options?: { companyId?: string | null; branches?: ReadonlyArray<{ id: string; companyId: string }> },
): boolean;
export declare function checkCompanyScope(principal: AccessPrincipal, companyId: string | null | undefined): AccessDenialFragment | null;
export declare function checkBranchScope(
  principal: AccessPrincipal,
  branchId: string | null | undefined,
  options?: { companyId?: string | null; branches?: ReadonlyArray<{ id: string; companyId: string }> },
): AccessDenialFragment | null;

export type FieldRule = { permission: string; fields: readonly string[] };
export declare function hiddenFieldsFor(principal: AccessPrincipal, rules: readonly FieldRule[]): string[];
export declare function projectFields<T>(principal: AccessPrincipal, rowOrRows: T, rules: readonly FieldRule[]): T;
export declare function assertWritableFields<T>(principal: AccessPrincipal, payload: T, rules: readonly FieldRule[], options?: { module?: string }): T;

export type AccessResource = { organizationId?: string | null; companyId?: string | null; branchId?: string | null; [key: string]: unknown };
export type AccessDecision =
  | Readonly<{ allowed: true; principal: AccessPrincipal; module: string | null; action: string | null }>
  | Readonly<{
      allowed: false;
      code: AccessErrorCode;
      status: number;
      module: string | null;
      permission: string | null;
      action: string | null;
      reason: string | null;
      conceal: boolean;
    }>;
export type AuthorizeInput = {
  principal?: AccessPrincipal | null;
  snapshot?: WorkspaceAccessSnapshot | null;
  module?: string;
  permission?: string;
  permissions?: readonly string[];
  action?: string;
  /** Waive only the module view permission (own-records self-service). */
  selfService?: boolean;
  resource?: AccessResource | null;
  context?: { companyId?: string | null; branchId?: string | null; [key: string]: unknown };
  recordPolicy?: (input: {
    principal: AccessPrincipal;
    snapshot?: WorkspaceAccessSnapshot | null;
    resource?: AccessResource | null;
    context?: Record<string, unknown>;
    action?: string;
  }) => AccessDenialFragment | null;
};
export declare function authorize(input: AuthorizeInput): AccessDecision;
export declare function requireAuthorization(input: AuthorizeInput): AccessPrincipal;
export declare function denialToError(decision: Extract<AccessDecision, { allowed: false }>): AccessDeniedError;

export declare function assertNoBlockingSodConflict(permissionKeys: readonly string[]): Array<{ key: string; severity: string }>;

export declare function accessLogFields(
  decision: Partial<AccessDecision> | null | undefined,
  principal: AccessPrincipal | null | undefined,
  ids?: { requestId?: string | null; correlationId?: string | null },
): Record<string, unknown>;
export declare function logAccessDenial(
  decision: AccessDecision | null | undefined,
  principal: AccessPrincipal | null | undefined,
  ids?: { requestId?: string | null; correlationId?: string | null },
  logger?: { warn(message: string, fields?: Record<string, unknown>): unknown },
): unknown;
export declare function recordAccessDenial(
  client: { query(text: string, values?: unknown[]): Promise<unknown> },
  input: {
    decision: AccessDecision;
    principal?: AccessPrincipal | null;
    request?: Request;
    env?: Record<string, string | undefined>;
    requestId?: string | null;
    correlationId?: string | null;
    entityType?: string;
    entityId?: string | null;
  },
): Promise<void>;

export declare const ACCESS_EVIDENCE_EVENTS: Readonly<{
  ROLES_CHANGED: "roles_changed";
  SCOPE_CHANGED: "access_scope_changed";
  MEMBER_ENABLED: "member_enabled";
  MEMBER_DISABLED: "member_disabled";
  INVITATION_ACCEPTED: "invitation_accepted";
}>;
export declare function recordAccessAssignmentEvent(
  client: { query(text: string, values?: unknown[]): Promise<unknown> },
  input: {
    organizationId: string;
    userId: string;
    actorUserId?: string | null;
    eventType: string;
    beforeState?: unknown;
    afterState?: unknown;
  },
): Promise<void>;

export * from "./control-runtime.js";
export * from "./module-entitlements.js";
export * from "./administration-service.js";
