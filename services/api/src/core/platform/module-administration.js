// Organization module administration (Settings > Modules).
//
// Tenant enablement (organization_modules) is ONE layer of module access; the
// runtime chain stays released → enabled → plan-entitled → permitted
// (../module-entitlements.js, unchanged here). Enabling a module never
// changes billing, and a plan that includes a module never enables it.
// Disabling a module hides and blocks it everywhere through that chain but
// deletes nothing: role assignments and business data are untouched, so
// re-enabling restores eligibility.
//
// Organization-global: requires modules.manage (Organisation Owner / System
// Administrator).
import { moduleAccessPermission } from "@vercentlabs/permissions";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { hasSessionPermission, requireSessionPermission } from "../access/index.js";
import { getBillingSummary } from "../billing/index.js";
import { entitlementFromBillingSummary } from "../access/index.js";
import { audit } from "../security/request-security.js";
import { appsNeeding, openWorkIn, requiredApps } from "./app-manifests.js";

export class ModuleAdministrationError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.name = "ModuleAdministrationError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

async function enabledModuleKeys(client, organizationId) {
  const rows = await client.query(`SELECT module_key FROM organization_modules WHERE organization_id = $1 AND status = 'enabled'`, [organizationId]);
  return new Set(rows.rows.map((row) => row.module_key));
}

function describeModule(module, { enabled, billingSummary, session }) {
  const { entitled, enforced } = entitlementFromBillingSummary(billingSummary, module.key);
  const released = module.availability === "released";
  return {
    key: module.key,
    name: module.name,
    description: module.description,
    released,
    enabled,
    planIncluded: entitled,
    entitlementEnforced: enforced,
    // Would a user with the right role reach it today? (enabled AND the plan
    // allows it). Roles/permissions still decide per user.
    availableToWorkspace: released && enabled && (entitled || !enforced),
    actorHasViewPermission: hasSessionPermission(session, moduleAccessPermission(module.key)),
  };
}

export async function listModuleAdministration(client, session, env = process.env) {
  requireSessionPermission(session, "modules.manage");
  const enabled = await enabledModuleKeys(client, session.organizationId);
  let billingSummary = null;
  try {
    billingSummary = await getBillingSummary(client, session.organizationId, env);
  } catch {
    billingSummary = null;
  }
  return ERP_MODULE_CATALOG.map((module) => describeModule(module, { enabled: enabled.has(module.key), billingSummary, session }));
}

export async function setOrganizationModuleEnabled(client, session, moduleKey, enabled, { request, env = process.env, confirmOpenWork = false } = {}) {
  requireSessionPermission(session, "modules.manage");
  const module = ERP_MODULE_CATALOG.find((entry) => entry.key === moduleKey);
  if (!module) throw new ModuleAdministrationError(404, "Unknown module.", "MODULE_UNAVAILABLE");
  if (module.availability !== "released") throw new ModuleAdministrationError(409, `${module.name} is not released yet.`, "MODULE_UNAVAILABLE");
  if (typeof enabled !== "boolean") throw new ModuleAdministrationError(422, "enabled must be true or false.", "MODULE_ADMIN_VALIDATION");

  // Lock the organization's rows so concurrent toggles serialize.
  const rows = (await client.query(`SELECT module_key, status FROM organization_modules WHERE organization_id = $1 FOR UPDATE`, [session.organizationId])).rows;
  const on = rows.filter((row) => row.status === "enabled").map((row) => row.module_key);
  const wasEnabled = on.includes(moduleKey);
  const nameOf = (key) => ERP_MODULE_CATALOG.find((entry) => entry.key === key)?.name ?? key;
  let switched = [];
  if (enabled && !wasEnabled) {
    // Turning an app on turns on the apps it needs (Manufacturing switches Stock on with it).
    switched = [moduleKey, ...requiredApps(moduleKey).filter((key) => !on.includes(key))];
  } else if (!enabled && wasEnabled) {
    const needing = appsNeeding(moduleKey, on);
    if (needing.length) {
      throw new ModuleAdministrationError(409, `${module.name} can't be turned off while ${needing.map(nameOf).join(" and ")} ${needing.length === 1 ? "is" : "are"} on: ${needing.length === 1 ? "it needs" : "they need"} ${module.name}. Turn ${needing.length === 1 ? "it" : "them"} off first.`,
        "MODULE_REQUIRED_BY_ANOTHER", { requiredBy: needing });
    }
    // Nothing is deleted; still, what is open in the app is listed and the owner asked to confirm.
    const openWork = await openWorkIn(client, session.organizationId, moduleKey);
    if (openWork.length && !confirmOpenWork) {
      throw new ModuleAdministrationError(409, `${module.name} has open work: ${openWork.map((entry) => `${entry.count} ${entry.label}`).join(", ")}. Its records are kept, and come back when it is turned on again.`,
        "MODULE_OPEN_WORK", { openWork });
    }
    switched = [moduleKey];
  }
  for (const key of switched) {
    await client.query(
      `INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at, updated_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'enabled' THEN now() END, now())
       ON CONFLICT (organization_id, module_key) DO UPDATE
         SET status = EXCLUDED.status,
             name = EXCLUDED.name,
             enabled_at = CASE WHEN EXCLUDED.status = 'enabled' THEN now() ELSE organization_modules.enabled_at END,
             updated_at = now()`,
      [session.organizationId, key, nameOf(key), enabled ? "enabled" : "disabled"],
    );
    await audit(client, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: enabled ? "module.enabled" : "module.disabled",
      entityType: "organization_module",
      entityId: null,
      metadata: { moduleKey: key, ...(key !== moduleKey ? { requiredBy: moduleKey } : {}) },
      beforeData: { moduleKey: key, enabled: !enabled },
      afterData: { moduleKey: key, enabled },
      request,
      env,
    });
  }
  const modules = await listModuleAdministration(client, session, env);
  return { module: modules.find((entry) => entry.key === moduleKey), changed: switched.length > 0, alsoEnabled: switched.filter((key) => key !== moduleKey) };
}
