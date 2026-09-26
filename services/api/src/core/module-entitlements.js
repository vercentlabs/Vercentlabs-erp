// The single composed authority for "can this user reach module X right
// now". The Shared Access boundary (./access/) builds its request-scoped
// WorkspaceAccessSnapshot on the same pure evaluator below, so the legacy
// per-module calls and the snapshot can never disagree:
//
//   PRODUCT MODULE (ERP_MODULE_CATALOG.availability === "released")
//         v
//   TENANT ENABLEMENT (organization_modules.status === "enabled")
//         v
//   PLAN / ENTITLEMENT (billing plan's modules list, enforcementMode-aware)
//         v
//   ROLE + PERMISSION (the module's base view permission, from
//                      @vercentlabs/permissions MODULE_ACCESS_PERMISSIONS)
//         v
//   -> accessible
//
// Fails closed at every stage: any lookup error is treated as
// "not accessible", never granting access on a system failure.
import { moduleAccessPermission } from "@vercentlabs/permissions";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { hasSessionPermission, PERMISSIONS } from "./access-control-runtime.js";
import { getBillingSummary } from "./billing/index.js";

export function getModuleDefinition(moduleId) {
  return ERP_MODULE_CATALOG.find((module) => module.key === moduleId) ?? null;
}

export function isModuleReleased(moduleId) {
  return getModuleDefinition(moduleId)?.availability === "released";
}

export async function getEnabledModuleKeys(client, organizationId) {
  const rows = await client.query(
    `SELECT module_key FROM organization_modules WHERE organization_id=$1 AND status='enabled'`,
    [organizationId],
  );
  return new Set(rows.rows.map((row) => row.module_key));
}

export function isModuleEnabledForTenant(moduleId, enabledModuleKeys) {
  return enabledModuleKeys.has(moduleId);
}

// billingSummary === null means the lookup failed: not entitled, enforced.
export function entitlementFromBillingSummary(billingSummary, moduleId) {
  if (!billingSummary) return { entitled: false, enforced: true };
  const modules = Array.isArray(billingSummary.modules) ? billingSummary.modules : [];
  return {
    entitled: modules.includes("*") || modules.includes(moduleId),
    enforced: billingSummary.enforcementMode === "enforce",
  };
}

export async function isModuleEntitled(client, organizationId, moduleId, env = process.env) {
  return entitlementFromBillingSummary(await getBillingSummary(client, organizationId, env), moduleId);
}

export function isModulePermitted(session, moduleId) {
  const permission = moduleAccessPermission(moduleId);
  if (!permission) return false;
  return hasSessionPermission(session, permission);
}

// Pure decision: no I/O. enabledModuleKeys === null means the enablement
// lookup failed (treated as disabled); billingSummary === null means the
// billing lookup failed (treated as not entitled, enforced).
export function evaluateModuleAccess({ moduleId, enabledModuleKeys, billingSummary, permitted }) {
  const definition = getModuleDefinition(moduleId);
  const name = definition?.name ?? moduleId;
  if (!definition || definition.availability !== "released") {
    return { moduleId, name, released: false, enabled: false, entitled: false, permitted: false, accessible: false, reason: "not_released" };
  }
  const enabled = Boolean(enabledModuleKeys && isModuleEnabledForTenant(moduleId, enabledModuleKeys));
  const { entitled, enforced } = entitlementFromBillingSummary(billingSummary, moduleId);
  const entitlementBlocks = !entitled && enforced;
  const accessible = enabled && !entitlementBlocks && permitted;
  let reason;
  if (!enabled) reason = "disabled";
  else if (entitlementBlocks) reason = "not_entitled";
  else if (!permitted) reason = "not_permitted";
  return { moduleId, name, released: true, enabled, entitled, permitted, accessible, reason };
}

const REASON_CODES = Object.freeze({
  not_released: "MODULE_NOT_AVAILABLE",
  disabled: "MODULE_DISABLED",
  not_entitled: "MODULE_NOT_ENTITLED",
  not_permitted: "MODULE_NOT_PERMITTED",
});

export async function resolveModuleAccess(client, session, moduleId, { enabledModuleKeys, billingSummary } = {}, env = process.env) {
  if (!isModuleReleased(moduleId)) {
    return evaluateModuleAccess({ moduleId, enabledModuleKeys: null, billingSummary: null, permitted: false });
  }

  let resolvedEnabledKeys = enabledModuleKeys;
  try {
    resolvedEnabledKeys ??= await getEnabledModuleKeys(client, session.organizationId);
  } catch {
    resolvedEnabledKeys = null;
  }

  let resolvedBilling = billingSummary;
  if (resolvedBilling === undefined) {
    try {
      resolvedBilling = await getBillingSummary(client, session.organizationId, env);
    } catch {
      resolvedBilling = null;
    }
  }

  return evaluateModuleAccess({
    moduleId,
    enabledModuleKeys: resolvedEnabledKeys,
    billingSummary: resolvedBilling,
    permitted: isModulePermitted(session, moduleId),
  });
}

export async function canUserAccessModule(client, session, moduleId, env = process.env) {
  return (await resolveModuleAccess(client, session, moduleId, {}, env)).accessible;
}

export class ModuleAccessError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ModuleAccessError";
    this.status = status;
    this.code = code;
  }
}

export async function assertModuleAccessible(client, session, moduleId, env = process.env) {
  const access = await resolveModuleAccess(client, session, moduleId, {}, env);
  if (access.accessible) return;
  const reason = access.reason ?? "not_permitted";
  const status = reason === "not_released" ? 404 : 403;
  throw new ModuleAccessError(status, `${access.name} is not available for this workspace.`, REASON_CODES[reason]);
}

export async function getAccessibleModules(client, session, env = process.env) {
  // Sequential, never Promise.all: a single pg client runs one query at a
  // time. Enablement and billing are each read ONCE for all 12 modules
  // (previously the billing summary was re-read per module); the per-module
  // decision itself is the pure evaluateModuleAccess().
  let enabledModuleKeys;
  try {
    enabledModuleKeys = await getEnabledModuleKeys(client, session.organizationId);
  } catch {
    enabledModuleKeys = null;
  }
  let billingSummary;
  try {
    billingSummary = await getBillingSummary(client, session.organizationId, env);
  } catch {
    billingSummary = null;
  }
  return ERP_MODULE_CATALOG.map((module) =>
    evaluateModuleAccess({
      moduleId: module.key,
      enabledModuleKeys,
      billingSummary,
      permitted: isModulePermitted(session, module.key),
    }),
  );
}

export { PERMISSIONS };
