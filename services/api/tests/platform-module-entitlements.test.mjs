import assert from "node:assert/strict";
import test from "node:test";

import { resolveModuleAccess, assertModuleAccessible, ModuleAccessError, isModuleReleased } from "../src/core/module-entitlements.js";

function clientReturning({ enabledRows = [], billingRows = [], usageRows = [], overrideRows = [] } = {}) {
  return {
    query: async (sql) => {
      if (/organization_modules/.test(sql)) return { rows: enabledRows };
      if (/organization_subscriptions/.test(sql)) return { rows: billingRows };
      if (/billing_usage_monthly/.test(sql)) return { rows: usageRows };
      if (/billing_entitlement_overrides/.test(sql)) return { rows: overrideRows };
      return { rows: [] };
    },
  };
}

test("isModuleReleased recognizes every catalogue module as released", () => {
  for (const key of ["crm", "sales", "accounting", "procurement", "stock", "manufacturing", "projects", "assets", "point-of-sale", "quality", "support", "hr-payroll"]) {
    assert.equal(isModuleReleased(key), true, `${key} should be released`);
  }
});

test("isModuleReleased returns false for an unknown module key", () => {
  assert.equal(isModuleReleased("not-a-real-module"), false);
});

test("resolveModuleAccess fails closed (not accessible) when the tenant-enablement lookup itself fails", async () => {
  const client = { query: async () => { throw new Error("db down"); } };
  const session = { organizationId: "org-1", roleSlugs: [], permissions: ["crm.view"] };
  const access = await resolveModuleAccess(client, session, "crm", {}, { NODE_ENV: "test" });
  assert.equal(access.accessible, false);
  assert.equal(access.reason, "disabled");
});

test("resolveModuleAccess: enabled + entitled + permitted composes to accessible", async () => {
  const client = clientReturning({
    enabledRows: [{ module_key: "crm" }],
    billingRows: [
      {
        status: "active",
        plan_code: "growth",
        plan_name: "Growth",
        billing_period: "monthly",
        current_period_ends_at: null,
        trial_ends_at: null,
        grace_ends_at: null,
        cancel_at_cycle_end: false,
        provider_subscription_id: null,
        modules_snapshot: ["crm", "sales"],
        limits_snapshot: {},
      },
    ],
  });
  const session = { organizationId: "org-1", roleSlugs: [], permissions: ["crm.view"] };
  const access = await resolveModuleAccess(client, session, "crm", {}, { NODE_ENV: "test" });
  assert.equal(access.accessible, true);
  assert.equal(access.reason, undefined);
});

test("resolveModuleAccess: enabled + entitled but missing the view permission is not_permitted", async () => {
  const client = clientReturning({
    enabledRows: [{ module_key: "crm" }],
    billingRows: [
      {
        status: "active",
        plan_code: "growth",
        plan_name: "Growth",
        billing_period: "monthly",
        current_period_ends_at: null,
        trial_ends_at: null,
        grace_ends_at: null,
        cancel_at_cycle_end: false,
        provider_subscription_id: null,
        modules_snapshot: ["crm"],
        limits_snapshot: {},
      },
    ],
  });
  const session = { organizationId: "org-1", roleSlugs: [], permissions: [] };
  const access = await resolveModuleAccess(client, session, "crm", {}, { NODE_ENV: "test" });
  assert.equal(access.accessible, false);
  assert.equal(access.reason, "not_permitted");
});

test("assertModuleAccessible throws 404 for a module that isn't released and 403 for a released-but-denied one", async () => {
  const client = { query: async () => ({ rows: [] }) };
  const session = { organizationId: "org-1", roleSlugs: [], permissions: [] };
  await assert.rejects(
    assertModuleAccessible(client, session, "not-a-real-module", { NODE_ENV: "test" }),
    (error) => error instanceof ModuleAccessError && error.status === 404,
  );
  await assert.rejects(
    assertModuleAccessible(client, session, "crm", { NODE_ENV: "test" }),
    (error) => error instanceof ModuleAccessError && error.status === 403,
  );
});
