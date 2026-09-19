// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/module-access.ts. The single composed authority for "can this user
// reach module X right now" — Phase 7's navigation registry (and any
// server-side guard) must call resolveModuleAccess()/assertModuleAccessible()
// rather than re-implement any part of this pipeline:
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
// Fails closed at every stage: any lookup error is treated as
// "not accessible", never granting access on a system failure.
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { hasSessionPermission, PERMISSIONS } from "./access-control-runtime.js";
import { getBillingSummary } from "./entitlements.js";

const MODULE_VIEW_PERMISSIONS = Object.freeze({
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

export async function isModuleEntitled(client, organizationId, moduleId, env = process.env) {
  const summary = await getBillingSummary(client, organizationId, env);
  const allowed = summary.modules.includes("*") || summary.modules.includes(moduleId);
  return { entitled: allowed, enforced: summary.enforcementMode === "enforce" };
}

export function isModulePermitted(session, moduleId) {
  const permission = MODULE_VIEW_PERMISSIONS[moduleId];
  if (!permission) return false;
  return hasSessionPermission(session, permission);
}

const REASON_CODES = Object.freeze({
  not_released: "MODULE_NOT_AVAILABLE",
  disabled: "MODULE_DISABLED",
  not_entitled: "MODULE_NOT_ENTITLED",
  not_permitted: "MODULE_NOT_PERMITTED",
});

export async function resolveModuleAccess(client, session, moduleId, { enabledModuleKeys } = {}, env = process.env) {
  const definition = getModuleDefinition(moduleId);
  const name = definition?.name ?? moduleId;

  if (!definition || definition.availability !== "released") {
    return { moduleId, name, released: false, enabled: false, entitled: false, permitted: false, accessible: false, reason: "not_released" };
  }

  let resolvedEnabledKeys = enabledModuleKeys;
  let enabled;
  try {
    resolvedEnabledKeys ??= await getEnabledModuleKeys(client, session.organizationId);
    enabled = isModuleEnabledForTenant(moduleId, resolvedEnabledKeys);
  } catch {
    enabled = false;
  }

  let entitled = false;
  let enforced = true;
  try {
    ({ entitled, enforced } = await isModuleEntitled(client, session.organizationId, moduleId, env));
  } catch {
    entitled = false;
    enforced = true;
  }
  const entitlementBlocks = !entitled && enforced;

  const permitted = isModulePermitted(session, moduleId);
  const accessible = enabled && !entitlementBlocks && permitted;
  let reason;
  if (!enabled) reason = "disabled";
  else if (entitlementBlocks) reason = "not_entitled";
  else if (!permitted) reason = "not_permitted";

  return { moduleId, name, released: true, enabled, entitled, permitted, accessible, reason };
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
  let enabledModuleKeys;
  try {
    enabledModuleKeys = await getEnabledModuleKeys(client, session.organizationId);
  } catch {
    enabledModuleKeys = new Set();
  }
  // Sequential, not Promise.all: resolveModuleAccess issues real queries
  // on this same client/connection (via isModuleEntitled -> getBillingSummary),
  // and a single pg client can only run one query at a time -- running all
  // 12 modules concurrently here is exactly what surfaced as a real
  // "client.query() when the client is already executing a query"
  // deprecation warning in the workspace shell (every authenticated page
  // calls this to build its navigation). The module catalog is small
  // (12 entries), so sequential resolution is not a meaningful latency
  // cost.
  const results = [];
  for (const module of ERP_MODULE_CATALOG) {
    results.push(await resolveModuleAccess(client, session, module.key, { enabledModuleKeys }, env));
  }
  return results;
}

export { PERMISSIONS };
