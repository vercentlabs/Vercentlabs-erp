// The Free plan's app choice (Shared Platform plan 2): Free is 1 user and 1 app. The company picks its app (at setup, or in Billing),
// and may switch to another app once every 30 days; the data of the app it leaves stays, and comes back if it switches back or
// upgrades. Standard and Custom include every app, so a choice made on Free is kept but not used while paying.
//
// The choice lives on organization_subscriptions.selected_modules; billing_module_switches keeps every pick (the switching rule reads
// it). Companies that were on Free before this rule keep the apps they had: their plan snapshot still lists them and they have no
// choice to make until they pick one.
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { countedApps, withRequiredApps } from "../platform/app-manifests.js";

import { BillingServiceError } from "./errors.js";
import { billingAudit, subscriptionRow } from "./shared.js";

export const APP_SWITCH_INTERVAL_DAYS = 30;
const RELEASED = new Set(ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map((module) => module.key));
const OWNER_ROLES = ["organization_owner", "system_administrator"];

function moduleList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

// What the company's plan lets it choose, and what it chose. `needsChoice` is true when a plan with an allowance gives no app yet.
export async function getAppChoice(client, organizationId) {
  const row = (await client.query(
    `SELECT s.selected_modules, s.selected_modules_at, s.modules_snapshot, plan.module_allowance, plan.code AS plan_code, plan.name AS plan_name
       FROM organization_subscriptions s
       JOIN billing_plan_prices price ON price.id = s.plan_price_id
       JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE s.organization_id = $1`, [organizationId])).rows[0];
  if (!row) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
  const allowance = row.module_allowance === null || row.module_allowance === undefined ? null : Number(row.module_allowance);
  const selected = row.selected_modules === null || row.selected_modules === undefined ? null : moduleList(row.selected_modules);
  const last = (await client.query(
    `SELECT created_at FROM billing_module_switches WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [organizationId])).rows[0];
  const lastSwitchAt = last ? new Date(last.created_at) : null;
  const nextSwitchAt = lastSwitchAt ? new Date(lastSwitchAt.getTime() + APP_SWITCH_INTERVAL_DAYS * 86_400_000) : null;
  const grandfathered = allowance !== null && selected === null && moduleList(row.modules_snapshot).length > 0;
  return {
    planCode: row.plan_code,
    planName: row.plan_name,
    allowance,
    selected,
    grandfathered,
    needsChoice: allowance !== null && !grandfathered && (selected === null || selected.length === 0),
    canSwitch: allowance !== null && (!nextSwitchAt || nextSwitchAt.getTime() <= Date.now()),
    nextSwitchAt: nextSwitchAt ? nextSwitchAt.toISOString() : null,
    lastSwitchAt: lastSwitchAt ? lastSwitchAt.toISOString() : null,
    switchIntervalDays: APP_SWITCH_INTERVAL_DAYS,
  };
}

// The apps a subscription gives, before support overrides: a plan with an allowance gives the chosen apps (or, for a company from
// before the rule, what its snapshot lists); any other plan gives its snapshot.
export function effectiveModulesFor({ moduleAllowance, selectedModules, modulesSnapshot }) {
  const snapshot = moduleList(modulesSnapshot);
  if (moduleAllowance === null || moduleAllowance === undefined) return snapshot;
  if (selectedModules === null || selectedModules === undefined) return snapshot;
  // An app the chosen one needs comes with it (Manufacturing brings Stock) and is not counted.
  return withRequiredApps(countedApps(moduleList(selectedModules)).slice(0, Number(moduleAllowance)));
}

// Picks (or switches) the company's app(s). Only an owner or administrator may; the first pick is free, later switches wait
// APP_SWITCH_INTERVAL_DAYS after the previous one. The chosen app is switched on for the company (its data, if any, is kept).
// Runs in the caller's tenant transaction (no provider call is involved).
export async function chooseApps(client, ctx, input = {}) {
  if (!OWNER_ROLES.some((role) => ctx.roleSlugs?.includes(role))) {
    throw new BillingServiceError(403, "Only the owner or an administrator can choose the company's app.", "BILLING_PERMISSION_DENIED");
  }
  const picked = [...new Set((Array.isArray(input.modules) ? input.modules : [input.module]).filter(Boolean).map(String))];
  if (!picked.length) throw new BillingServiceError(422, "Choose an app.", "BILLING_APP_REQUIRED");
  const unknown = picked.filter((key) => !RELEASED.has(key));
  if (unknown.length) throw new BillingServiceError(422, `${unknown.join(", ")} is not an app you can choose.`, "BILLING_APP_UNKNOWN");
  {
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (!sub) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
    const choice = await getAppChoice(client, ctx.organizationId);
    if (choice.allowance === null) throw new BillingServiceError(409, `The ${choice.planName} plan includes every app; there is nothing to choose.`, "BILLING_APPS_INCLUDED");
    // The apps a chosen app needs come with it and don't count against the allowance (Manufacturing with Stock is one app).
    const modules = countedApps(picked);
    if (modules.length > choice.allowance) {
      throw new BillingServiceError(422, `The ${choice.planName} plan includes ${choice.allowance} app${choice.allowance === 1 ? "" : "s"}. Upgrade to Standard for every app.`, "BILLING_APP_ALLOWANCE");
    }
    const before = choice.selected ?? [];
    if (before.length === modules.length && before.every((key) => modules.includes(key))) return { ...choice, changed: false };
    if (before.length && !choice.canSwitch) {
      throw new BillingServiceError(409, `You can switch your app again on ${choice.nextSwitchAt.slice(0, 10)} (once every ${APP_SWITCH_INTERVAL_DAYS} days), or upgrade to Standard for every app.`, "BILLING_APP_SWITCH_TOO_SOON");
    }
    await client.query(`UPDATE organization_subscriptions SET selected_modules = $2::jsonb, selected_modules_at = now() WHERE organization_id = $1`,
      [ctx.organizationId, JSON.stringify(modules)]);
    await client.query(`INSERT INTO billing_module_switches (organization_id, from_modules, to_modules, switched_by) VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
      [ctx.organizationId, JSON.stringify(before), JSON.stringify(modules), ctx.userId ?? null]);
    // The chosen app is switched on (organization_modules is tenant-scoped; the caller's transaction is the company's).
    for (const key of withRequiredApps(modules)) {
      const name = ERP_MODULE_CATALOG.find((module) => module.key === key)?.name ?? key;
      await client.query(
        `INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1, $2, $3, 'enabled', now())
         ON CONFLICT (organization_id, module_key) DO UPDATE SET status = 'enabled', enabled_at = COALESCE(organization_modules.enabled_at, now())`,
        [ctx.organizationId, key, name]);
    }
    await billingAudit(client, {
      organizationId: ctx.organizationId, actorUserId: ctx.userId, eventType: before.length ? "billing.apps.switched" : "billing.apps.chosen", entityId: sub.id,
      beforeData: { modules: before }, afterData: { modules },
    });
    return { ...(await getAppChoice(client, ctx.organizationId)), changed: true };
  }
}
