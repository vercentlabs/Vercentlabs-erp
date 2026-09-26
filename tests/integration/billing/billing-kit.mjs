// Shared fixtures for the real-PostgreSQL billing suites (`pnpm test:billing:db`).
// Fixtures are written with the migration role; billing domain code runs on the
// restricted runtime role (DATABASE_URL), exactly like the web app and worker.
// The payment provider is the REAL Razorpay adapter pointed at a local stand-in.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { createRazorpayProvider, runBillingMaintenance } from "../../../services/api/src/core/billing/index.js";
import { startRazorpayStandIn } from "../../support/razorpay-standin.mjs";

export const KEY_ID = "rzp_test_standin";
export const KEY_SECRET = "standin_key_secret";
export const WEBHOOK_SECRET = "standin_webhook_secret";
export const PREVIOUS_WEBHOOK_SECRET = "standin_previous_webhook_secret";

export function requireDatabase() {
  assert.ok(process.env.MIGRATION_DATABASE_URL, "MIGRATION_DATABASE_URL is required: billing DB tests never skip.");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL (restricted runtime role) is required.");
}

export async function createBillingKit() {
  requireDatabase();
  const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, application_name: "billing-tests-owner" });
  await owner.connect();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, application_name: "billing-tests-runtime" });
  const standin = await startRazorpayStandIn({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
  // Provider plans are permanent: the stand-in "remembers" every plan a price version is already linked to.
  for (const row of (await owner.query(`SELECT provider_plan_id FROM billing_plan_prices WHERE provider_plan_id IS NOT NULL`)).rows) {
    standin.plans.set(row.provider_plan_id, { id: row.provider_plan_id, entity: "plan" });
  }
  const env = {
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: PREVIOUS_WEBHOOK_SECRET,
    RAZORPAY_API_BASE: standin.apiBase,
    RAZORPAY_REQUEST_TIMEOUT_MS: "1000",
    BILLING_CHECKOUT_ENABLED: "true",
    BILLING_ENFORCEMENT_MODE: "enforce",
  };
  const provider = createRazorpayProvider(env);
  const organizations = [];
  const users = [];

  async function newUser(label) {
    const id = randomUUID();
    await owner.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'x','active',now())`, [id, `billing-${label}-${id}@test.invalid`, label]);
    users.push(id);
    return id;
  }

  // An organisation on the current Free plan with `members` active members.
  async function organization({ members = 1, pendingInvitations = 0 } = {}) {
    const ownerId = await newUser("owner");
    const organizationId = randomUUID();
    await owner.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Billing Org',$2,'IN','Asia/Kolkata','INR',$3)`, [
      organizationId, `billing-org-${organizationId}`, ownerId,
    ]);
    organizations.push(organizationId);
    await owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [organizationId, ownerId]);
    const memberIds = [ownerId];
    for (let i = 1; i < members; i += 1) {
      const id = await newUser(`member${i}`);
      memberIds.push(id);
      await owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [organizationId, id]);
    }
    for (let i = 0; i < pendingInvitations; i += 1) {
      await owner.query(
        `INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at) VALUES($5,$1,$2,'member',$3,$4, now() + interval '7 days')`,
        [organizationId, `invitee-${i}-${organizationId}@test.invalid`, `tok-${randomUUID()}`, ownerId, randomUUID()],
      );
    }
    return { organizationId, ownerId, memberIds, ctx: { organizationId, userId: ownerId, email: "owner@test.invalid" } };
  }

  // Runs `work` with a dedicated runtime-role client.
  async function withRuntime(work) {
    const client = await pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  const maintenance = (steps = null, workerId = `test-worker-${randomUUID().slice(0, 6)}`) =>
    runBillingMaintenance({ connect: () => pool.connect(), provider, workerId, batchSize: 50, leaseSeconds: 60, steps });

  const subscription = async (organizationId) =>
    (
      await owner.query(
        `SELECT s.*, plan.code AS plan_code, price.version AS price_version FROM organization_subscriptions s
           JOIN billing_plan_prices price ON price.id = s.plan_price_id JOIN billing_plans plan ON plan.id = price.plan_id WHERE s.organization_id=$1`,
        [organizationId],
      )
    ).rows[0];

  async function close() {
    if (organizations.length) {
      await owner.query(`DELETE FROM billing_webhook_events WHERE organization_id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
      await owner.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
    }
    if (users.length) await owner.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => undefined);
    await owner.end().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await standin.close();
  }

  return { owner, pool, standin, env, provider, organization, newUser, withRuntime, maintenance, subscription, close };
}

// Drives an organisation to an active Standard subscription with `users` total users.
export async function subscribeStandard(kit, org, users) {
  const { startSeatCheckout, confirmSeatCheckout } = await import("../../../services/api/src/core/billing/index.js");
  const checkout = await kit.withRuntime((client) => startSeatCheckout(client, org.ctx, { users }, kit.provider));
  const response = kit.standin.authenticate(checkout.providerSubscriptionId, { status: "active" });
  const confirmed = await kit.withRuntime((client) => confirmSeatCheckout(client, org.ctx, { checkoutSessionId: checkout.checkoutSessionId, ...response }, kit.provider));
  assert.equal(confirmed.state, "active");
  return checkout;
}

export const expectCode = (code) => (error) => {
  assert.equal(error.code, code, error.message);
  return true;
};
