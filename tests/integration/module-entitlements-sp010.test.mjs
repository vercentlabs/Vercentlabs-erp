// Real PostgreSQL integration test — SP010/SP011 Section 1 follow-up.
// resolveModuleAccess/assertModuleAccessible (services/api/src/core/
// module-entitlements.js) is the SHARED, universal gate every CRM/POS
// route calls before anything else (crm-context.ts/pos-context.ts's
// requireCrmAccess/requirePosAccess both call it unconditionally, for
// reads and writes alike) -- yet a repository-wide search before writing
// this file found ZERO existing tests exercising it against a real
// database. That is a real gap in its own right, independent of whether
// its behavior turns out correct: the single most-called authorization
// gate in the CRM/POS request path had never actually been proven.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { resolveModuleAccess, assertModuleAccessible, canUserAccessModule, ModuleAccessError } from "../../services/api/src/core/module-entitlements.js";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("SP010/SP011: the shared module-access gate against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  async function makeOrg({ enableCrm = true, subscription = null } = {}) {
    const orgId = randomUUID();
    const ownerId = randomUUID();
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'SP010 Owner','x','active',now())`,
      [ownerId, `sp010-owner-${ownerId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'SP010 Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `sp010-org-${orgId}`, ownerId],
    );
    if (enableCrm) {
      await admin.query(`INSERT INTO organization_modules(organization_id,module_key,name,status,enabled_at) VALUES ($1,'crm','CRM','enabled',now())`, [orgId]);
    }
    if (!subscription) {
      // migration 051's organizations_ensure_subscription trigger just
      // auto-provisioned a founder-preview row on the insert above --
      // remove it to simulate the "no row at all" edge case this specific
      // test scenario is about (a pre-trigger org, a manually deleted row,
      // or data corruption). The trigger makes this NOT the normal path
      // going forward, but it remains a real, defensible state to guard
      // against.
      await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]);
    }
    if (subscription) {
      const planId = randomUUID();
      const priceId = randomUUID();
      const subId = randomUUID();
      await admin.query(`INSERT INTO billing_plans(id,code,name,trial_days,modules) VALUES($1,$2,'Test Plan',0,$3::jsonb)`, [
        planId,
        `sp010-plan-${planId}`,
        JSON.stringify(subscription.planModules),
      ]);
      await admin.query(`INSERT INTO billing_plan_prices(id,plan_id,billing_period,amount_paise) VALUES($1,$2,'monthly',100000)`, [priceId, planId]);
      await admin.query(
        // migration 051's trigger already created a default founder-preview
        // row on the organizations insert above; overwrite it with the
        // exact state this test case wants.
        `INSERT INTO organization_subscriptions(id,organization_id,plan_price_id,status,billing_period,grace_ends_at,modules_snapshot)
         VALUES($1,$2,$3,$4,'monthly',$5,$6::jsonb)
         ON CONFLICT (organization_id) DO UPDATE SET
           id=EXCLUDED.id, plan_price_id=EXCLUDED.plan_price_id, status=EXCLUDED.status,
           billing_period=EXCLUDED.billing_period, grace_ends_at=EXCLUDED.grace_ends_at, modules_snapshot=EXCLUDED.modules_snapshot`,
        [subId, orgId, priceId, subscription.status, subscription.graceEndsAt ?? null, JSON.stringify(subscription.planModules)],
      );
    }
    return { orgId, ownerId };
  }

  async function cleanup(orgId, ownerId) {
    await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(
      `DELETE FROM billing_plan_prices WHERE plan_id IN (SELECT id FROM billing_plans WHERE code LIKE 'sp010-plan-%')`,
    ).catch(() => undefined);
    await admin.query(`DELETE FROM billing_plans WHERE code LIKE 'sp010-plan-%'`).catch(() => undefined);
    await admin.query(`DELETE FROM organization_modules WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
  }

  const permittedSession = (orgId) => ({ organizationId: orgId, roleSlugs: [], permissions: ["crm.view"] });
  const unpermittedSession = (orgId) => ({ organizationId: orgId, roleSlugs: [], permissions: [] });

  try {
    await t.test("no subscription row at all: module access is BLOCKED, regardless of enforcement mode (documented fail-closed-on-lookup-error design)", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: true, subscription: null });
      try {
        const observeResult = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "test" });
        assert.equal(observeResult.accessible, false, "observe mode still blocks on a genuine lookup failure -- this differs from requireBillingWriteAccess's own observe-mode leniency, and is this file's most important finding");
        assert.equal(observeResult.reason, "not_entitled");

        const enforceResult = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(enforceResult.accessible, false);
        assert.equal(enforceResult.reason, "not_entitled");

        await assert.rejects(
          () => assertModuleAccessible(admin, permittedSession(orgId), "crm", { NODE_ENV: "test" }),
          (error) => error instanceof ModuleAccessError && error.status === 403 && error.code === "MODULE_NOT_ENTITLED",
        );
      } finally {
        await cleanup(orgId, ownerId);
      }
    });

    await t.test("an active subscription whose plan includes crm: accessible", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: true, subscription: { status: "active", planModules: ["crm"] } });
      try {
        const result = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(result.accessible, true);
        assert.equal(await canUserAccessModule(admin, permittedSession(orgId), "crm", { NODE_ENV: "production" }), true);
      } finally {
        await cleanup(orgId, ownerId);
      }
    });

    await t.test("an active subscription whose plan does NOT include crm: blocked in enforce mode, allowed in observe mode", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: true, subscription: { status: "active", planModules: ["sales"] } });
      try {
        const enforceResult = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(enforceResult.accessible, false);
        assert.equal(enforceResult.reason, "not_entitled");

        const observeResult = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "test" });
        assert.equal(observeResult.accessible, true, "a genuinely-resolved (not error) non-entitlement still respects observe mode, same as requireBillingWriteAccess");
      } finally {
        await cleanup(orgId, ownerId);
      }
    });

    await t.test("an expired subscription: module access itself is a separate question from write access -- module remains READABLE (hasWriteAccess governs writes, not this gate)", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: true, subscription: { status: "expired", planModules: ["crm"] } });
      try {
        const result = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(result.accessible, true, "expired only affects hasWriteAccess/requireBillingWriteAccess, not whether the module's plan-inclusion check passes");
      } finally {
        await cleanup(orgId, ownerId);
      }
    });

    await t.test("tenant has not enabled the module: blocked regardless of billing state", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: false, subscription: { status: "active", planModules: ["crm"] } });
      try {
        const result = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(result.accessible, false);
        assert.equal(result.reason, "disabled");
      } finally {
        await cleanup(orgId, ownerId);
      }
    });

    await t.test("caller lacks the module's base view permission: blocked regardless of billing state", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: true, subscription: { status: "active", planModules: ["crm"] } });
      try {
        const result = await resolveModuleAccess(admin, unpermittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(result.accessible, false);
        assert.equal(result.reason, "not_permitted");
      } finally {
        await cleanup(orgId, ownerId);
      }
    });

    await t.test("internal (Founder Preview) subscription with a wildcard module list: accessible", async () => {
      const { orgId, ownerId } = await makeOrg({ enableCrm: true, subscription: { status: "internal", planModules: ["*"] } });
      try {
        const result = await resolveModuleAccess(admin, permittedSession(orgId), "crm", {}, { NODE_ENV: "production" });
        assert.equal(result.accessible, true);
      } finally {
        await cleanup(orgId, ownerId);
      }
    });
  } finally {
    await admin.end();
  }
});
