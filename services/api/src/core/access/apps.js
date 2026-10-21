// Which other apps (modules) the organization has: CRM reaches into Sales (quotations), Accounting (invoices), Projects, Support and
// Stock only when the organization has that app enabled and is entitled to it. Within CRM the organization owner passes every CRM
// check; outside CRM the owner passes only for apps the organization has — owning the workspace never switches on an app that was not
// bought, and a role carrying another app's permissions does not reach that app while it is off.
//
// The web passes the apps on the context (context.apps, from the request's access snapshot). Code without one (scripts, the worker)
// loads them once per context from the database; until loaded, a synchronous check fails closed.
import { evaluateModuleAccess, getEnabledModuleKeys } from "./module-entitlements.js";
import { getBillingSummary } from "../billing/index.js";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

const loaded = new WeakMap();
const isOwner = (context) => Boolean(context?.roleSlugs?.includes("organization_owner"));

// The organization's available apps, as a Set of module keys, or null while unknown (a synchronous caller with no context.apps).
function knownApps(context) {
  if (Array.isArray(context?.apps)) return new Set(context.apps);
  return loaded.get(context) ?? null;
}

// Loads (once per context) the apps the organization has enabled and is entitled to, from the same decision the access snapshot uses.
export async function loadApps(client, context) {
  const known = knownApps(context);
  if (known) return known;
  let enabled = null;
  let billing = null;
  try { enabled = await getEnabledModuleKeys(client, context.organizationId); } catch { enabled = null; }
  try { billing = await getBillingSummary(client, context.organizationId); } catch { billing = null; }
  const apps = new Set(ERP_MODULE_CATALOG
    .map((module) => evaluateModuleAccess({ moduleId: module.key, enabledModuleKeys: enabled, billingSummary: billing, permitted: true }))
    .filter((access) => access.accessible)
    .map((access) => access.moduleId));
  loaded.set(context, apps);
  return apps;
}

// The apps an access snapshot says the organization has (enabled, released, not blocked by entitlement), for context.apps.
export function appsFromSnapshot(snapshot) {
  if (!snapshot?.modules) return undefined;
  return snapshot.modules.filter((entry) => entry.released && entry.enabled && entry.reason !== "not_entitled").map((entry) => entry.moduleId);
}

// Whether the organization has the app (synchronous: false while unknown).
export const hasApp = (context, app) => Boolean(knownApps(context)?.has(app));

// Whether the caller may use `permission` of another app: the organization has the app, and the caller is the owner or holds it.
export const canInApp = (context, app, permission) => hasApp(context, app) && (isOwner(context) || Boolean(context?.permissions?.includes(permission)));

// The same, loading the apps first when the context has none (for the operations themselves, which must fail closed).
export async function mayInApp(client, context, app, permission) {
  await loadApps(client, context);
  return canInApp(context, app, permission);
}

// Whether the organization has the app, loading the apps first when the context has none: what a bridge checks before it runs.
export async function appOn(client, context, app) {
  return (await loadApps(client, context)).has(app);
}
