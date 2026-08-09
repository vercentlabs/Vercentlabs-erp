// Canonical module-access resolution — the single place future navigation
// (Prompt 5+) and any server-side guard should ask "can this user reach
// module X right now?" and get one trustworthy, diagnosable answer.
//
// See docs/implementation/ERP_AUTHORIZATION_MODEL_004.md for the full
// pipeline this implements:
//
//   PRODUCT MODULE (ERP_MODULE_CATALOG.availability === "released")
//         v
//   TENANT ENABLEMENT (organization_modules.status === "enabled")
//         v
//   PLAN / ENTITLEMENT (billing plan's modules list, enforcementMode-aware)
//         v
//   ROLE + PERMISSION (session.permissions includes the module's base view permission)
//         v
//   -> accessible
//
// Company/branch record scope is a DELIBERATELY separate concern (Part 10):
// this module never filters by activeCompanyId/activeBranchId, and
// "accessible" here must never be read as "can see this data in every
// company/branch" — existing per-record scoping (recordScope() in
// services/api/src/crm.js, companyWhere() in procurement, etc.) is
// untouched and remains the authority for that.
import { ERP_MODULE_CATALOG, type ErpModule } from "@vercentlabs/shared-types";

import { cache } from "react";

import type { SessionContext, WorkspaceSessionContext } from "@/lib/auth";
import { requireApiWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { getBillingSummary } from "@/lib/billing";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/http";

export type ModuleAccessReason =
  | "not_released"
  | "disabled"
  | "not_entitled"
  | "not_permitted";

export type ModuleAccess = {
  moduleId: string;
  name: string;
  released: boolean;
  enabled: boolean;
  entitled: boolean;
  permitted: boolean;
  accessible: boolean;
  reason?: ModuleAccessReason;
};

// The permission that gates baseline visibility into each business module.
// Kept here (not duplicated per caller) so every module-access check uses
// the exact same permission the module's own routes/pages already gate on
// — see apps/web/src/app/(app)/<module>/page.tsx and services/api/src/
// <module>/index.js's own requirePermission(context, "<module>.view")-style
// checks for the modules audited in docs/implementation/
// ERP_WEB_AUDIT_001.md.
const MODULE_VIEW_PERMISSIONS: Readonly<Record<string, string>> = Object.freeze({
  crm: PERMISSIONS.crmView,
  sales: PERMISSIONS.salesView,
  accounting: PERMISSIONS.accountingView,
  procurement: PERMISSIONS.procurementView,
  stock: PERMISSIONS.stockView,
  manufacturing: PERMISSIONS.manufacturingView,
  projects: PERMISSIONS.projectsView,
  assets: PERMISSIONS.assetsView,
  "point-of-sale": PERMISSIONS.posView,
  quality: PERMISSIONS.qualityView,
  support: PERMISSIONS.supportView,
  "hr-payroll": PERMISSIONS.hrPayrollView,
});

export function getModuleDefinition(moduleId: string): ErpModule | null {
  return ERP_MODULE_CATALOG.find((module) => module.key === moduleId) ?? null;
}

export function isModuleReleased(moduleId: string): boolean {
  return getModuleDefinition(moduleId)?.availability === "released";
}

// Request-scoped memoization (Part 27: navigation resolution + the
// per-module page guard must not each run their own copy of this query
// within the same request — see docs/implementation/
// ERP_NAVIGATION_FOUNDATION_006.md Section 15).
export const getEnabledModuleKeys = cache(async (
  organizationId: string,
): Promise<Set<string>> => {
  const rows = await query<{ module_key: string }>(
    `SELECT module_key FROM organization_modules WHERE organization_id=$1 AND status='enabled'`,
    [organizationId],
  );
  return new Set(rows.map((row) => row.module_key));
});

export function isModuleEnabledForTenant(
  moduleId: string,
  enabledModuleKeys: ReadonlySet<string>,
): boolean {
  return enabledModuleKeys.has(moduleId);
}

// Mirrors assertModuleEntitlement()'s own allowed/enforcementMode logic in
// apps/web/src/lib/billing.ts exactly, but returns a boolean instead of
// throwing — this resolver reports "not entitled" as one diagnosable
// reason among several, it does not itself decide how a caller responds.
// In "observe" mode (the non-production default, see
// billingEnforcementMode()) a plan mismatch is surfaced as entitled=false
// but never forces accessible=false, matching how assertModuleEntitlement
// only throws when enforcementMode==="enforce".
export async function isModuleEntitled(
  organizationId: string,
  moduleId: string,
): Promise<{ entitled: boolean; enforced: boolean }> {
  const summary = await getBillingSummary(organizationId);
  const allowed =
    summary.modules.includes("*") || summary.modules.includes(moduleId);
  return { entitled: allowed, enforced: summary.enforcementMode === "enforce" };
}

export function isModulePermitted(
  session: SessionContext,
  moduleId: string,
): boolean {
  const permission = MODULE_VIEW_PERMISSIONS[moduleId];
  if (!permission) return false;
  return hasPermission(session, permission);
}

// The single composed answer. Fails closed at every stage: any lookup
// error (a missing billing record, an unresolvable organization) is
// treated as "not accessible" rather than silently granting access — see
// Part 20 ("Can a system failure default to module access?") in
// docs/implementation/ERP_AUTHORIZATION_MODEL_004.md.
export async function resolveModuleAccess(
  session: WorkspaceSessionContext,
  moduleId: string,
  options?: { enabledModuleKeys?: ReadonlySet<string> },
): Promise<ModuleAccess> {
  const definition = getModuleDefinition(moduleId);
  const name = definition?.name ?? moduleId;

  if (!definition || definition.availability !== "released") {
    return {
      moduleId,
      name,
      released: false,
      enabled: false,
      entitled: false,
      permitted: false,
      accessible: false,
      reason: "not_released",
    };
  }

  let enabledModuleKeys = options?.enabledModuleKeys;
  let enabled: boolean;
  try {
    enabledModuleKeys ??= await getEnabledModuleKeys(session.organizationId);
    enabled = isModuleEnabledForTenant(moduleId, enabledModuleKeys);
  } catch {
    enabled = false;
  }

  let entitled = false;
  let enforced = true;
  try {
    ({ entitled, enforced } = await isModuleEntitled(
      session.organizationId,
      moduleId,
    ));
  } catch {
    entitled = false;
    enforced = true;
  }
  // In "observe" billing enforcement mode, a plan mismatch is reported
  // truthfully (entitled=false) but does not by itself block access —
  // matching assertModuleEntitlement()'s own behavior.
  const entitlementBlocks = !entitled && enforced;

  const permitted = isModulePermitted(session, moduleId);

  const accessible = enabled && !entitlementBlocks && permitted;
  let reason: ModuleAccessReason | undefined;
  if (!enabled) reason = "disabled";
  else if (entitlementBlocks) reason = "not_entitled";
  else if (!permitted) reason = "not_permitted";

  return {
    moduleId,
    name,
    released: true,
    enabled,
    entitled,
    permitted,
    accessible,
    reason,
  };
}

export async function canUserAccessModule(
  session: WorkspaceSessionContext,
  moduleId: string,
): Promise<boolean> {
  return (await resolveModuleAccess(session, moduleId)).accessible;
}

// Machine-readable denial codes, one per ModuleAccessReason — surfaced in
// HttpError.code so API clients (including the mobile app) can distinguish
// "you don't have permission" from "your organization hasn't enabled/paid
// for this module" without parsing English error text.
const REASON_CODES: Readonly<Record<ModuleAccessReason, string>> = Object.freeze({
  not_released: "MODULE_NOT_AVAILABLE",
  disabled: "MODULE_DISABLED",
  not_entitled: "MODULE_NOT_ENTITLED",
  not_permitted: "MODULE_NOT_PERMITTED",
});

// The server-boundary guard: the narrow, reusable call every module's
// route-context builder makes before touching business data. Fails closed
// (resolveModuleAccess never grants access on a lookup error, see above) and
// always throws a diagnosable HttpError rather than returning a boolean, so
// callers can't accidentally ignore a denial the way they could with
// canUserAccessModule()'s plain boolean.
export async function assertModuleAccessible(
  session: WorkspaceSessionContext,
  moduleId: string,
): Promise<void> {
  const access = await resolveModuleAccess(session, moduleId);
  if (access.accessible) return;
  const reason = access.reason ?? "not_permitted";
  const status = reason === "not_released" ? 404 : 403;
  throw new HttpError(
    status,
    `${access.name} is not available for this workspace.`,
    REASON_CODES[reason],
  );
}

// For the modules that route requests through requireApiWorkspace() with no
// per-module session helper of their own (manufacturing, projects, assets,
// point-of-sale, quality, support, hr-payroll) — one call replaces
// `await requireApiWorkspace()` and adds the same module gate the other
// modules' *Session() helpers apply.
export async function requireModuleWorkspace(
  moduleId: string,
): Promise<WorkspaceSessionContext> {
  const session = await requireApiWorkspace();
  await assertModuleAccessible(session, moduleId);
  return session;
}

// The function future navigation (Prompt 5+) is expected to call once per
// page render: one shared organization_modules query, then one resolution
// per catalogue module.
// Request-scoped memoization (Part 27 of Prompt 6, extended in Prompt 7):
// resolveNavigation() and resolveQuickCreate() both need the full
// accessible-module set for the same session within the same request —
// cache() collapses that to one computation (its own internal queries were
// already deduped via getEnabledModuleKeys/getBillingSummary's own
// caching; this additionally dedupes the 12x resolveModuleAccess mapping
// itself).
export const getAccessibleModules = cache(async (
  session: WorkspaceSessionContext,
): Promise<ModuleAccess[]> => {
  let enabledModuleKeys: ReadonlySet<string>;
  try {
    enabledModuleKeys = await getEnabledModuleKeys(session.organizationId);
  } catch {
    enabledModuleKeys = new Set();
  }
  return Promise.all(
    ERP_MODULE_CATALOG.map((module) =>
      resolveModuleAccess(session, module.key, { enabledModuleKeys }),
    ),
  );
});
