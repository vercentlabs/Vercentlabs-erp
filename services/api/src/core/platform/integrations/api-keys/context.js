// GET /api/v1/platform/context: what an API key may know about its own
// workspace. No users, roles, billing internals, secrets or provider tokens.
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { getBillingSummary } from "../../../billing/index.js";
import { entitlementFromBillingSummary, getEnabledModuleKeys, isModuleReleased } from "../../../access/index.js";
import { API_VERSION } from "./scopes.js";

export async function getApiPlatformContext(client, principal, env = process.env) {
  const organization = (await client.query(`SELECT id, name, slug, country_code, timezone, base_currency FROM organizations WHERE id=$1`, [principal.organizationId])).rows[0];
  const enabled = await getEnabledModuleKeys(client, principal.organizationId);
  let billing = null;
  try {
    billing = await getBillingSummary(client, principal.organizationId, env);
  } catch {
    billing = null;
  }
  // A module is reported only when released, enabled and (when enforced) on the plan.
  const modules = ERP_MODULE_CATALOG.map((module) => module.key)
    .filter((key) => isModuleReleased(key) && enabled.has(key))
    .filter((key) => {
      const { entitled, enforced } = entitlementFromBillingSummary(billing, key);
      return entitled || !enforced;
    });
  return {
    apiVersion: API_VERSION,
    organization: { id: organization.id, name: organization.name, slug: organization.slug, countryCode: organization.country_code?.trim(), timezone: organization.timezone, baseCurrency: organization.base_currency?.trim() },
    app: { id: principal.developerAppId, name: principal.developerAppName },
    apiKey: { id: principal.apiKeyId, scopes: [...principal.scopes] },
    modules,
  };
}
