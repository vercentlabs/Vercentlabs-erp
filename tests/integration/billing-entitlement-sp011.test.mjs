// Real PostgreSQL integration test — SP011 (shared subscription-access
// entitlement policy). Proves getBillingSummary/requireBillingWriteAccess
// (services/api/src/core/entitlements.js) against every status
// organization_subscriptions_status_check actually allows, plus the real
// bugs found and fixed across two passes:
//   1. hasWriteAccess used to be DEFINED TWICE (entitlements.js and
//      billing.js), colliding in the services/api barrel's `export *` --
//      whichever module's star-export Node resolved last silently won
//      for every caller, with no error. Consolidated to one definition
//      (billing.js); this file proves the barrel now serves it correctly.
//   2. requireBillingWriteAccess used to hard-throw 409 for an
//      organization with NO organization_subscriptions row at all (never
//      initialised) exactly the same as an org whose subscription
//      actually expired -- those are different failure modes, and outside
//      enforce mode the first one must never block a mutation (every
//      existing test fixture organization in this repo has zero billing
//      setup, and enforcement defaults to "observe" outside production).
//   3. That fix originally over-corrected: it fail-OPENED for a missing
//      subscription row regardless of enforcement mode, which means it
//      would have granted unrestricted writes in production too. An
//      absent subscription record must never itself prove entitlement.
//      The corrected policy: outside enforce mode, still don't block
//      (unchanged, dev/test-safe default); IN enforce mode, a missing row
//      is treated exactly like an inactive subscription and blocks
//      ordinary business writes -- every real organization is expected to
//      carry an explicit, auditable row (see migrations 005 and 049's
//      founder-preview backfill), so a row still missing at that point is
//      a genuine provisioning gap, not a bypass.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { getBillingSummary, requireBillingWriteAccess, EntitlementError } from "../../services/api/src/core/billing/index.js";
import { hasWriteAccess as barrelHasWriteAccess } from "../../services/api/src/index.js";
import { hasWriteAccess } from "../../services/api/src/core/billing/index.js";

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

test("SP011: subscription-access entitlement policy against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  try {
  await t.test("the barrel export no longer has a competing hasWriteAccess definition — both resolve identically", () => {
    assert.equal(barrelHasWriteAccess, hasWriteAccess, "services/api's public barrel must serve the single billing.js definition, not a shadow copy");
  });

  await t.test("hasWriteAccess: every status the DB actually allows, including the two real bugs this pass fixed", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    // Bug #1 fixed: internal (Founder Preview) always has write access.
    assert.equal(hasWriteAccess({ status: "internal" }, now), true);
    assert.equal(hasWriteAccess({ status: "active" }, now), true);
    assert.equal(hasWriteAccess({ status: "authenticated" }, now), true);
    assert.equal(hasWriteAccess({ status: "trialing", trialEndsAt: "2026-07-01T00:00:00Z" }, now), true, "trial still running");
    assert.equal(hasWriteAccess({ status: "trialing", trialEndsAt: "2026-06-01T00:00:00Z" }, now), false, "trial already ended");
    assert.equal(hasWriteAccess({ status: "past_due", graceEndsAt: "2026-07-01T00:00:00Z" }, now), true, "in grace period");
    assert.equal(hasWriteAccess({ status: "past_due", graceEndsAt: "2026-06-01T00:00:00Z" }, now), false, "grace period elapsed");
    assert.equal(hasWriteAccess({ status: "past_due" }, now), false, "past_due with no grace end at all");
    assert.equal(hasWriteAccess({ status: "halted", graceEndsAt: "2026-07-01T00:00:00Z" }, now), false, "halted: retries exhausted, business writes stop regardless of any leftover grace date");
    assert.equal(hasWriteAccess({ status: "checkout_pending" }, now), false);
    // Bug #2 fixed: a stale future trialEndsAt on a status that is NOT
    // "trialing" must never grant access.
    assert.equal(hasWriteAccess({ status: "cancelled", trialEndsAt: "2099-01-01T00:00:00Z" }, now), false, "cancelled must never be rescued by a leftover trial date");
    assert.equal(hasWriteAccess({ status: "expired", trialEndsAt: "2099-01-01T00:00:00Z" }, now), false);
    assert.equal(hasWriteAccess({ status: "completed" }, now), false);
    assert.equal(hasWriteAccess(null, now), false);
  });

  await t.test("requireBillingWriteAccess: an organization with NO subscription row is NOT blocked outside enforce mode (dev/test-safe default)", async () => {
    const orgId = randomUUID();
    const ownerId = randomUUID();
    try {
      await admin.query(
        `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'SP011 Owner','x','active',now())`,
        [ownerId, `sp011-owner-${ownerId}@test.invalid`],
      );
      await admin.query(
        `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'SP011 No-Billing Org',$2,'IN','Asia/Kolkata','INR',$3)`,
        [orgId, `sp011-no-billing-${orgId}`, ownerId],
      );
      // migration 051's organizations_ensure_subscription trigger just
      // auto-provisioned a founder-preview row on the insert above --
      // delete it to simulate the genuine "no row at all" edge case (a
      // pre-trigger org, a manually deleted row, data corruption) this
      // test is specifically about; the trigger makes this no longer the
      // NORMAL path, but the fail-open/fail-closed behavior below must
      // still hold for whenever it does occur.
      await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]);
      await assert.rejects(
        () => getBillingSummary(admin, orgId),
        (error) => error instanceof EntitlementError && error.status === 409,
        "getBillingSummary (used to DISPLAY billing state) still reports honestly that nothing is configured",
      );
      const result = await requireBillingWriteAccess(admin, orgId, { NODE_ENV: "test" });
      assert.equal(result.enforcementMode, "observe");
      assert.equal(result.writeAccess, true, "observe mode never blocks, even with no subscription row -- this is the existing dev/test-safe default, unchanged");
      assert.equal(result.status, "unprovisioned");
    } finally {
      await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
    }
  });

  await t.test("requireBillingWriteAccess: a missing subscription row CANNOT grant unrestricted access in enforce mode -- it is denied exactly like an inactive subscription", async () => {
    const orgId = randomUUID();
    const ownerId = randomUUID();
    try {
      await admin.query(
        `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'SP011 Owner','x','active',now())`,
        [ownerId, `sp011-owner-${ownerId}@test.invalid`],
      );
      await admin.query(
        `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'SP011 No-Billing Org Enforce',$2,'IN','Asia/Kolkata','INR',$3)`,
        [orgId, `sp011-no-billing-enforce-${orgId}`, ownerId],
      );
      // Same trigger-cleanup as the observe-mode case above.
      await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]);
      await assert.rejects(
        () => requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" }),
        (error) =>
          error instanceof EntitlementError &&
          error.status === 402 &&
          error.code === "ENTITLEMENT_SUBSCRIPTION_MISSING",
        "an absent subscription record must never itself grant unrestricted access once enforcement is active",
      );
      // Also confirmed via an explicit BILLING_ENFORCEMENT_MODE override,
      // independent of NODE_ENV -- the same guarantee either way enforce
      // mode is actually selected.
      await assert.rejects(
        () => requireBillingWriteAccess(admin, orgId, { NODE_ENV: "test", BILLING_ENFORCEMENT_MODE: "enforce" }),
        (error) => error instanceof EntitlementError && error.status === 402 && error.code === "ENTITLEMENT_SUBSCRIPTION_MISSING",
      );
    } finally {
      await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
    }
  });

  async function withSubscription(status, extra, testFn) {
    const orgId = randomUUID();
    const ownerId = randomUUID();
    const planId = randomUUID();
    const priceId = randomUUID();
    const subscriptionId = randomUUID();
    try {
      await admin.query(
        `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'SP011 Owner','x','active',now())`,
        [ownerId, `sp011-owner-${ownerId}@test.invalid`],
      );
      await admin.query(
        `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'SP011 Org',$2,'IN','Asia/Kolkata','INR',$3)`,
        [orgId, `sp011-org-${orgId}`, ownerId],
      );
      await admin.query(
        `INSERT INTO billing_plans(id,code,name,trial_days) VALUES($1,$2,'SP011 Plan',14)`,
        [planId, `sp011-plan-${planId}`],
      );
      await admin.query(
        `INSERT INTO billing_plan_prices(id,plan_id,billing_period,amount_paise) VALUES($1,$2,'monthly',100000)`,
        [priceId, planId],
      );
      await admin.query(
        // migration 051's organizations_ensure_subscription trigger already
        // created a default founder-preview row the instant the org above
        // was inserted -- ON CONFLICT DO UPDATE replaces it with the exact
        // state this test actually wants to exercise, rather than colliding
        // with it.
        `INSERT INTO organization_subscriptions(id,organization_id,plan_price_id,status,billing_period,trial_ends_at,grace_ends_at)
         VALUES($1,$2,$3,$4,'monthly',$5,$6)
         ON CONFLICT (organization_id) DO UPDATE SET
           id=EXCLUDED.id, plan_price_id=EXCLUDED.plan_price_id, status=EXCLUDED.status,
           billing_period=EXCLUDED.billing_period, trial_ends_at=EXCLUDED.trial_ends_at, grace_ends_at=EXCLUDED.grace_ends_at`,
        [subscriptionId, orgId, priceId, status, extra.trialEndsAt ?? null, extra.graceEndsAt ?? null],
      );
      await testFn(orgId);
    } finally {
      await admin.query(`DELETE FROM organization_subscriptions WHERE id=$1`, [subscriptionId]).catch(() => undefined);
      await admin.query(`DELETE FROM billing_plan_prices WHERE id=$1`, [priceId]).catch(() => undefined);
      await admin.query(`DELETE FROM billing_plans WHERE id=$1`, [planId]).catch(() => undefined);
      await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
    }
  }

  await t.test("requireBillingWriteAccess: an active subscription is never blocked, in enforce mode", async () => {
    await withSubscription("active", {}, async (orgId) => {
      const result = await requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" });
      assert.equal(result.writeAccess, true);
    });
  });

  await t.test("requireBillingWriteAccess: an expired subscription is blocked in enforce mode, with read data still returned via getBillingSummary", async () => {
    await withSubscription("expired", {}, async (orgId) => {
      await assert.rejects(
        () => requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" }),
        (error) => error instanceof EntitlementError && error.status === 402 && error.code === "ENTITLEMENT_SUBSCRIPTION_INACTIVE",
      );
      const summary = await getBillingSummary(admin, orgId, { NODE_ENV: "production" });
      assert.equal(summary.writeAccess, false);
      assert.equal(summary.status, "expired", "read/export access is preserved — the caller can still see the real state");
    });
  });

  await t.test("requireBillingWriteAccess: expired subscription is NOT blocked in observe mode (default outside production)", async () => {
    await withSubscription("expired", {}, async (orgId) => {
      const result = await requireBillingWriteAccess(admin, orgId, { NODE_ENV: "test" });
      assert.equal(result.enforcementMode, "observe");
      assert.equal(result.writeAccess, false, "the policy still correctly computes false — only enforcement is skipped");
    });
  });

  await t.test("requireBillingWriteAccess: internal (Founder Preview) subscriptions are never blocked, even in enforce mode", async () => {
    await withSubscription("internal", {}, async (orgId) => {
      const result = await requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" });
      assert.equal(result.writeAccess, true);
    });
  });

  await t.test("requireBillingWriteAccess: a cancelled subscription with a stale future trial_ends_at is still blocked (bug #2, at the route-enforcement level)", async () => {
    await withSubscription("cancelled", { trialEndsAt: new Date(Date.now() + 365 * 86_400_000).toISOString() }, async (orgId) => {
      await assert.rejects(
        () => requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" }),
        (error) => error instanceof EntitlementError && error.status === 402,
      );
    });
  });

  await t.test("requireBillingWriteAccess: past_due within its grace window is allowed; past_due after grace ends is blocked", async () => {
    await withSubscription("past_due", { graceEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }, async (orgId) => {
      const result = await requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" });
      assert.equal(result.writeAccess, true);
    });
    await withSubscription("past_due", { graceEndsAt: new Date(Date.now() - 7 * 86_400_000).toISOString() }, async (orgId) => {
      await assert.rejects(
        () => requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" }),
        (error) => error instanceof EntitlementError && error.status === 402,
      );
    });
  });
  } finally {
    await admin.end();
  }
});
