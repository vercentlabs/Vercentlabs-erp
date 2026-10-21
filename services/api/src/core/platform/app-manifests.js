// The 12 apps' manifests (modules/*/manifest.js) and the switching rules they give. An app's `depends` are switched on with it and
// can't be switched off while it is on (Manufacturing needs Stock); on a plan with an app allowance, an app that is only there because
// another needs it doesn't count as an app of its own. `openWork` is listed, and the owner asked to confirm, before an app is switched off.
import { manifest as accounting } from "../../modules/accounting/manifest.js";
import { manifest as assets } from "../../modules/assets/manifest.js";
import { manifest as crm } from "../../modules/crm/manifest.js";
import { manifest as hrPayroll } from "../../modules/hr-payroll/manifest.js";
import { manifest as manufacturing } from "../../modules/manufacturing/manifest.js";
import { manifest as pointOfSale } from "../../modules/point-of-sale/manifest.js";
import { manifest as procurement } from "../../modules/procurement/manifest.js";
import { manifest as projects } from "../../modules/projects/manifest.js";
import { manifest as quality } from "../../modules/quality/manifest.js";
import { manifest as sales } from "../../modules/sales/manifest.js";
import { manifest as stock } from "../../modules/stock/manifest.js";
import { manifest as support } from "../../modules/support/manifest.js";

export const APP_MANIFESTS = Object.freeze(Object.fromEntries(
  [accounting, procurement, sales, crm, stock, manufacturing, projects, assets, pointOfSale, quality, support, hrPayroll].map((entry) => [entry.key, entry])));

// The apps `key` needs, directly or through another app it needs.
export function requiredApps(key, seen = new Set()) {
  for (const needed of APP_MANIFESTS[key]?.depends ?? []) {
    if (seen.has(needed)) continue;
    seen.add(needed);
    requiredApps(needed, seen);
  }
  return [...seen];
}

// The given apps and every app they need.
export const withRequiredApps = (keys) => [...new Set([...keys, ...keys.flatMap((key) => requiredApps(key))])];

// The apps among `keys` that need `key` (what keeps it from being switched off).
export const appsNeeding = (key, keys) => keys.filter((other) => other !== key && requiredApps(other).includes(key));

// The apps that count against a plan's app allowance: an app needed by another chosen app comes with it.
export const countedApps = (keys) => keys.filter((key) => !appsNeeding(key, keys).length);

// What is still open in an app, for the message shown before it is switched off: [{ label, count }] with a count above zero.
export async function openWorkIn(client, organizationId, key) {
  const open = [];
  for (const { label, sql } of APP_MANIFESTS[key]?.openWork ?? []) {
    const count = Number((await client.query(sql, [organizationId])).rows[0]?.count ?? 0);
    if (count > 0) open.push({ label, count });
  }
  return open;
}
