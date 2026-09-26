// Commercial model, immutable price versions, provisioning and the 3 -> 1
// included-user migration, against real PostgreSQL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  calculateSeatCharge,
  currentPrice,
  getBillingSummary,
  listPlanCatalogue,
  provisionCustomSubscription,
  requireBillingWriteAccess,
  startSeatCheckout,
} from "../../../services/api/src/core/billing/index.js";
import { createBillingKit, expectCode, subscribeStandard } from "./billing-kit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migration061 = fs.readFileSync(path.join(root, "database/platform/migrations/061_billing_commercial_model_and_recovery.sql"), "utf8").replace(/^BEGIN;|^COMMIT;/gm, "");

test("commercial model, price versions and migration 061", async (t) => {
  const kit = await createBillingKit();
  try {
    await t.test("canonical pricing: 1 user free, then ₹1,000 per additional user per month", async () => {
      const standard = await currentPrice(kit.owner, "standard");
      assert.equal(standard.included_users, 1);
      assert.equal(Number(standard.amount_paise), 100000);
      const quote = (users) => calculateSeatCharge({ includedUsers: standard.included_users, perUserPaise: standard.amount_paise, totalUsers: users }).monthlyPaise;
      assert.equal(quote(1), 0);
      assert.equal(quote(2), 100000);
      assert.equal(quote(5), 400000);
      assert.equal(quote(10), 900000);
    });

    await t.test("catalogue: Free (1 user), Standard, and Custom that is contact-only; archived plans hidden", async () => {
      // Only the commercial catalogue matters here; other suites may briefly add their own fixture plans.
      const CATALOGUE = ["free", "standard", "enterprise", "launch", "growth", "scale", "founder-preview"];
      const plans = (await listPlanCatalogue(kit.owner, null, kit.env)).filter((plan) => CATALOGUE.includes(plan.code));
      assert.deepEqual(plans.map((plan) => plan.code), ["free", "standard", "enterprise"], "archived plans are hidden");
      const [free, standard, custom] = plans;
      assert.equal(free.includedUsers, 1);
      assert.equal(standard.includedUsers, 1);
      assert.equal(standard.perUserPricePaise, 100000);
      assert.equal(standard.purchasable, true);
      assert.equal(custom.name, "Custom");
      assert.equal(custom.contactSales, true);
      assert.equal(custom.purchasable, false);
    });

    await t.test("a new organisation starts on the current Free version with 1 included user and write access", async () => {
      const org = await kit.organization();
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.plan_code, "free");
      assert.equal(sub.price_version, 2);
      assert.equal(sub.included_users_snapshot, 1);
      const summary = await kit.withRuntime((client) => getBillingSummary(client, org.organizationId, kit.env));
      assert.equal(summary.writeAccess, true, "Free is an active plan with normal business writes");
      assert.equal(sub.provider_subscription_id, null);
    });

    await t.test("price versions are immutable in the database", async () => {
      const v1 = (await kit.owner.query(`SELECT price.id FROM billing_plan_prices price JOIN billing_plans plan ON plan.id=price.plan_id WHERE plan.code='standard' AND price.version=1`)).rows[0];
      const v2 = await currentPrice(kit.owner, "standard");
      await assert.rejects(kit.owner.query(`UPDATE billing_plan_prices SET amount_paise = 150000 WHERE id=$1`, [v2.price_id]), /immutable/);
      await assert.rejects(kit.owner.query(`UPDATE billing_plan_prices SET included_users = 3 WHERE id=$1`, [v2.price_id]), /immutable/);
      await assert.rejects(kit.owner.query(`UPDATE billing_plan_prices SET active = true WHERE id=$1`, [v1.id]), /cannot be reactivated/);
      const linked = (await kit.owner.query(`SELECT id FROM billing_plan_prices WHERE provider_plan_id IS NOT NULL LIMIT 1`)).rows[0];
      if (linked) await assert.rejects(kit.owner.query(`UPDATE billing_plan_prices SET provider_plan_id = 'plan_other' WHERE id=$1`, [linked.id]), /permanently linked/);
      await assert.rejects(
        kit.owner.query(`INSERT INTO billing_plan_prices (plan_id, billing_period, amount_paise, version, active) SELECT plan_id, 'monthly', 1, 99, true FROM billing_plan_prices WHERE id=$1`, [v2.price_id]),
        /one_active/,
      );
    });

    await t.test("new checkout uses only the current price version; an old version id is refused", async () => {
      const org = await kit.organization();
      const v1 = (await kit.owner.query(`SELECT price.id FROM billing_plan_prices price JOIN billing_plans plan ON plan.id=price.plan_id WHERE plan.code='standard' AND price.version=1`)).rows[0];
      await assert.rejects(kit.withRuntime((client) => startSeatCheckout(client, org.ctx, { planPriceId: v1.id, users: 3 }, kit.provider)), expectCode("BILLING_PRICE_CHANGED"));
      const checkout = await kit.withRuntime((client) => startSeatCheckout(client, org.ctx, { users: 3 }, kit.provider));
      const session = (await kit.owner.query(`SELECT plan_price_id, expected_quantity, expected_provider_plan_id FROM billing_checkout_sessions WHERE id=$1`, [checkout.checkoutSessionId])).rows[0];
      const v2 = await currentPrice(kit.owner, "standard");
      assert.equal(session.plan_price_id, v2.price_id);
      assert.equal(session.expected_quantity, 2);
      assert.equal(session.expected_provider_plan_id, v2.provider_plan_id, "each price version is linked to exactly one provider plan");
      const remote = kit.standin.subscriptions.get(checkout.providerSubscriptionId);
      assert.equal(remote.quantity, 2, "Razorpay quantity = additional users");
      assert.equal(remote.plan_id, v2.provider_plan_id);
      assert.equal(remote.notes.vercentlabs_checkout_session_id, checkout.checkoutSessionId);
      assert.ok(remote.expire_by > 0, "unpaid provider subscriptions expire on their own");
    });

    await t.test("Custom cannot be bought online; it is provisioned through the audited internal path", async () => {
      const org = await kit.organization({ members: 4 });
      await provisionCustomSubscription(kit.owner, {
        organizationId: org.organizationId, actorUserId: org.ownerId, users: 25, modules: ["crm", "sales"], limits: { companies: 5 },
        contractReference: "CONTRACT-001", startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 365 * 86400000),
      });
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.plan_code, "enterprise");
      assert.equal(sub.included_users_snapshot, 25);
      assert.deepEqual(sub.modules_snapshot, ["crm", "sales"]);
      const summary = await kit.withRuntime((client) => getBillingSummary(client, org.organizationId, kit.env));
      assert.equal(summary.writeAccess, true);
      assert.equal(summary.limits.companies, 5);
      await assert.rejects(kit.withRuntime((client) => startSeatCheckout(client, org.ctx, { users: 30 }, kit.provider)), expectCode("BILLING_CUSTOM_CONTRACT"));
      const audit = (await kit.owner.query(`SELECT after_data FROM audit_events WHERE organization_id=$1 AND event_type='billing.custom.provisioned'`, [org.organizationId])).rows[0];
      assert.equal(audit.after_data.contractReference, "CONTRACT-001");
      await assert.rejects(
        provisionCustomSubscription(kit.owner, { organizationId: org.organizationId, users: 5, modules: ["not-a-module"], contractReference: "X", startsAt: new Date(), endsAt: new Date(Date.now() + 1000) }),
        expectCode("BILLING_CUSTOM_INVALID"),
      );
      // A lapsed contract stops business writes.
      await kit.owner.query(`UPDATE organization_subscriptions SET current_period_ends_at = now() - interval '1 day' WHERE organization_id=$1`, [org.organizationId]);
      await assert.rejects(kit.withRuntime((client) => requireBillingWriteAccess(client, org.organizationId, kit.env)), expectCode("ENTITLEMENT_SUBSCRIPTION_INACTIVE"));
    });

    await t.test("migration 061: Free moves to 1 user with an overage grace; real paid contracts keep their terms (idempotent re-run)", async () => {
      const freeOrg = await kit.organization({ members: 2, pendingInvitations: 1 });
      const soloOrg = await kit.organization({ members: 1 });
      const paidOrg = await kit.organization({ members: 3 });
      await subscribeStandard(kit, paidOrg, 5);
      const v1 = async (code) => (await kit.owner.query(`SELECT price.id FROM billing_plan_prices price JOIN billing_plans plan ON plan.id=price.plan_id WHERE plan.code=$1 AND price.version=1`, [code])).rows[0].id;
      await kit.owner.query("BEGIN");
      try {
        // Put fixtures back on the pre-061 terms, then run the migration body again.
        await kit.owner.query(`UPDATE organization_subscriptions SET plan_price_id=$2, included_users_snapshot=3, seat_overage_since=NULL WHERE organization_id = ANY($1::uuid[])`, [
          [freeOrg.organizationId, soloOrg.organizationId], await v1("free"),
        ]);
        await kit.owner.query(`UPDATE organization_subscriptions SET plan_price_id=$2, included_users_snapshot=3, paid_seats=2, metadata='{}'::jsonb WHERE organization_id=$1`, [paidOrg.organizationId, await v1("standard")]);
        await kit.owner.query(migration061);
        const free = await kit.subscription(freeOrg.organizationId);
        assert.equal(free.price_version, 2);
        assert.equal(free.included_users_snapshot, 1);
        assert.ok(free.seat_overage_since, "2 members + 1 pending invitation > 1 included user starts the grace period");
        assert.equal(free.metadata.previous_included_users, 3);
        const solo = await kit.subscription(soloOrg.organizationId);
        assert.equal(solo.included_users_snapshot, 1);
        assert.equal(solo.seat_overage_since, null);
        const paid = await kit.subscription(paidOrg.organizationId);
        assert.equal(paid.price_version, 1, "a real provider subscription keeps its price version");
        assert.equal(paid.included_users_snapshot, 3);
        assert.equal(paid.paid_seats, 2, "paid quantity preserved: the next charge does not change");
        assert.equal(paid.metadata.legacy_commercial_terms, true);
        const members = (await kit.owner.query(`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id=$1 AND status='active'`, [freeOrg.organizationId])).rows[0].n;
        assert.equal(members, 2, "nobody is removed or disabled");
      } finally {
        await kit.owner.query("ROLLBACK");
      }
    });

    await t.test("a historical subscription on a retired version still resolves its snapshot", async () => {
      const org = await kit.organization({ members: 1 });
      const v1 = (await kit.owner.query(`SELECT price.id FROM billing_plan_prices price JOIN billing_plans plan ON plan.id=price.plan_id WHERE plan.code='standard' AND price.version=1`)).rows[0].id;
      await kit.owner.query(`UPDATE organization_subscriptions SET plan_price_id=$2, status='active', provider_subscription_id=$3, included_users_snapshot=3, paid_seats=4 WHERE organization_id=$1`, [
        org.organizationId, v1, `sub_legacy${randomUUID().slice(0, 6)}`,
      ]);
      const summary = await kit.withRuntime((client) => getBillingSummary(client, org.organizationId, kit.env));
      assert.equal(summary.planCode, "standard");
      assert.equal(summary.seats.capacity, 7);
      assert.equal(summary.writeAccess, true);
    });
  } finally {
    await kit.close();
  }
});
