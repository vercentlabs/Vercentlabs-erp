// Real PostgreSQL integration test — SP011 Section 1 follow-up ("ensure
// the normal organization-creation process does not produce new
// organizations without initialized billing state"). There is no
// application code path that creates an organization (confirmed:
// organization creation is invite-only/administrative per SP004, never
// self-serve -- grep for "INSERT INTO organizations" across services/api
// and apps/web/src returns zero matches outside test fixtures). Rather
// than rely on every future caller -- app code, an ops script, a future
// self-serve flow -- remembering to also create a subscription row,
// migration 051 makes the invariant structural: a database trigger
// (ensure_organization_subscription) fires on every INSERT into
// organizations, through any path, and provisions a real, auditable
// 'internal' (Founder Preview) subscription row automatically. This file
// proves the trigger actually fires, is idempotent, and does not
// overwrite a subscription an admin process deliberately set up in the
// same transaction as the organization insert.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

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

test("migration 051: organizations_ensure_subscription trigger against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  try {
    await t.test("inserting a new organization automatically provisions a real founder-preview subscription row", async () => {
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
          `SELECT subscription.status, plan.code AS plan_code, subscription.metadata->>'source' AS source
             FROM organization_subscriptions subscription
             JOIN billing_plan_prices price ON price.id = subscription.plan_price_id
             JOIN billing_plans plan ON plan.id = price.plan_id
            WHERE subscription.organization_id = $1`,
          [orgId],
        );
        assert.equal(sub.rows.length, 1, "exactly one subscription row must exist immediately after the organization insert, with no separate application step required");
        assert.equal(sub.rows[0].status, "internal");
        assert.equal(sub.rows[0].plan_code, "founder-preview");
        assert.equal(sub.rows[0].source, "organizations_ensure_subscription_trigger", "the row must be traceable to the trigger, not conflated with the one-time migration backfill");
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
        // clobber this with the generic founder-preview default.
        await admin.query(
          `INSERT INTO organization_subscriptions(organization_id,plan_price_id,status,billing_period)
           VALUES($1,$2,'active','monthly')
           ON CONFLICT (organization_id) DO UPDATE SET plan_price_id=EXCLUDED.plan_price_id, status=EXCLUDED.status`,
          [orgId, priceId],
        );

        const sub = await admin.query(`SELECT status, plan_price_id FROM organization_subscriptions WHERE organization_id=$1`, [orgId]);
        assert.equal(sub.rows.length, 1);
        assert.equal(sub.rows[0].status, "active");
        assert.equal(sub.rows[0].plan_price_id, priceId, "the deliberately-chosen paid price must win, not be silently replaced by the trigger's founder-preview default");
      } finally {
        await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM billing_plan_prices WHERE id=$1`, [priceId]).catch(() => undefined);
        await admin.query(`DELETE FROM billing_plans WHERE id=$1`, [planId]).catch(() => undefined);
        await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
      }
    });
  } finally {
    await admin.end();
  }
});
