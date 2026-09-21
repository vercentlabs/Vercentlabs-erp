// Real PostgreSQL integration test — SP011 Section 1 follow-up ("ensure
// the normal organization-creation process does not produce new
// organizations without initialized billing state"), CORRECTED after a
// real, confirmed defect found during visual-QA preflight review.
//
// The original migration 051 trigger granted EVERY newly-created
// organization an unconditional 'internal' (Founder Preview) subscription
// -- every module, no expiry hasWriteAccess() ever enforces, at
// amount_paise = 0, forever. Founder Preview was always meant for
// "existing development organisations" (migration 005's own plan
// description) and the one-time historical backfill (049), never a
// silent default for every future organization including ordinary paying
// customers -- left as shipped, it would have made the billing system
// meaningless for anyone who signed up after it. Migration 052 fixes this
// forward (CREATE OR REPLACE FUNCTION, same trigger, corrected body): new
// organizations now default to a genuine trial of the base paid plan
// ('launch'), with a real, enforced trial_ends_at and the narrower
// module/limit set that plan actually grants -- not Founder Preview.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { hasWriteAccess } from "../../services/api/src/core/billing.js";

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

test("migration 052: new organizations get a real trial, never an automatic Founder Preview grant", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  try {
    await t.test("inserting a new organization provisions an active Free plan subscription (3 users), NOT Founder Preview", async () => {
      const orgId = randomUUID();
      const ownerId = randomUUID();
      try {
        await admin.query(
          `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Trigger Test','x','active',now())`,
          [ownerId, `trigger-test-${ownerId}@test.invalid`],
        );
        await admin.query(
          `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Trigger Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
          [orgId, `trigger-test-org-${orgId}`, ownerId],
        );

        const sub = await admin.query(
          `SELECT subscription.status, subscription.trial_ends_at, subscription.modules_snapshot, subscription.limits_snapshot, subscription.included_users_snapshot,
                  plan.code AS plan_code, plan.trial_days, subscription.metadata->>'source' AS source
             FROM organization_subscriptions subscription
             JOIN billing_plan_prices price ON price.id = subscription.plan_price_id
             JOIN billing_plans plan ON plan.id = price.plan_id
            WHERE subscription.organization_id = $1`,
          [orgId],
        );
        assert.equal(sub.rows.length, 1, "exactly one subscription row must exist immediately after the organization insert, with no separate application step required");
        const row = sub.rows[0];

        assert.notEqual(row.status, "internal", "REGRESSION GUARD: a new organization must never automatically receive unconditional Founder Preview access");
        assert.notEqual(row.plan_code, "founder-preview", "REGRESSION GUARD: a new organization must never be silently signed up for the founder-preview plan");
        assert.equal(row.status, "active", "the Free plan is active immediately; there is no trial to expire");
        assert.equal(row.plan_code, "free");
        assert.equal(row.source, "organizations_ensure_subscription_trigger");
        assert.equal(row.trial_ends_at, null);
        assert.equal(row.included_users_snapshot, 3, "Free includes 3 users");
        assert.equal(hasWriteAccess({ status: row.status }, new Date()), true);
        assert.ok(Array.isArray(row.modules_snapshot) && row.modules_snapshot.length > 0, "the plan carries a real module entitlement");
        assert.notEqual(row.limits_snapshot.companies, 25, "Free uses its own limits, not founder-preview's generous ones");
      } finally {
        await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
      }
    });

    await t.test("an organization created with its OWN real subscription row in the same transaction keeps that row -- the trigger never overwrites an intentional choice", async () => {
      const orgId = randomUUID();
      const ownerId = randomUUID();
      const planId = randomUUID();
      const priceId = randomUUID();
      try {
        await admin.query(
          `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Trigger Test 2','x','active',now())`,
          [ownerId, `trigger-test2-${ownerId}@test.invalid`],
        );
        await admin.query(`INSERT INTO billing_plans(id,code,name,trial_days) VALUES($1,$2,'Real Paid Plan',0)`, [planId, `trigger-test-plan-${planId}`]);
        await admin.query(`INSERT INTO billing_plan_prices(id,plan_id,billing_period,amount_paise) VALUES($1,$2,'monthly',999900)`, [priceId, planId]);
        await admin.query(
          `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Trigger Test Org 2',$2,'IN','Asia/Kolkata','INR',$3)`,
          [orgId, `trigger-test-org2-${orgId}`, ownerId],
        );
        // Simulates an operational process that, in the SAME transaction,
        // deliberately signs the new org up for a real paid plan --
        // ON CONFLICT (organization_id) DO NOTHING in the trigger must not
        // clobber this with the generic trial default.
        await admin.query(
          `INSERT INTO organization_subscriptions(organization_id,plan_price_id,status,billing_period)
           VALUES($1,$2,'active','monthly')
           ON CONFLICT (organization_id) DO UPDATE SET plan_price_id=EXCLUDED.plan_price_id, status=EXCLUDED.status`,
          [orgId, priceId],
        );

        const sub = await admin.query(`SELECT status, plan_price_id FROM organization_subscriptions WHERE organization_id=$1`, [orgId]);
        assert.equal(sub.rows.length, 1);
        assert.equal(sub.rows[0].status, "active");
        assert.equal(sub.rows[0].plan_price_id, priceId, "the deliberately-chosen paid price must win, not be silently replaced by the trigger's trial default");
      } finally {
        await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM billing_plan_prices WHERE id=$1`, [priceId]).catch(() => undefined);
        await admin.query(`DELETE FROM billing_plans WHERE id=$1`, [planId]).catch(() => undefined);
        await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
      }
    });

    await t.test("Founder Preview status now only exists on an organization through an explicit action, never as a side effect of creating it", async () => {
      const orgId = randomUUID();
      const ownerId = randomUUID();
      try {
        await admin.query(
          `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Trigger Test 3','x','active',now())`,
          [ownerId, `trigger-test3-${ownerId}@test.invalid`],
        );
        await admin.query(
          `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Trigger Test Org 3',$2,'IN','Asia/Kolkata','INR',$3)`,
          [orgId, `trigger-test-org3-${orgId}`, ownerId],
        );
        const auto = await admin.query(
          `SELECT status FROM organization_subscriptions WHERE organization_id=$1`,
          [orgId],
        );
        assert.equal(auto.rows[0].status, "active", "before any explicit action, the org must only ever have the automatic Free plan, never internal status");

        // An explicit, deliberate admin action CAN still grant Founder
        // Preview -- that capability is intentionally preserved, only the
        // automatic default changed.
        const founderPrice = await admin.query(
          `SELECT price.id FROM billing_plan_prices price JOIN billing_plans plan ON plan.id=price.plan_id WHERE plan.code='founder-preview' AND price.billing_period='custom' AND price.active`,
        );
        await admin.query(
          `UPDATE organization_subscriptions SET status='internal', plan_price_id=$2 WHERE organization_id=$1`,
          [orgId, founderPrice.rows[0].id],
        );
        const explicit = await admin.query(`SELECT status FROM organization_subscriptions WHERE organization_id=$1`, [orgId]);
        assert.equal(explicit.rows[0].status, "internal", "Founder Preview remains available as a deliberate, explicit action -- only the silent automatic grant was removed");
      } finally {
        await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
      }
    });
  } finally {
    await admin.end();
  }
});
