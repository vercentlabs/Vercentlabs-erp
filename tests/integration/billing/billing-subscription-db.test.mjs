// Seats, cancellation, reconciliation and the entitlement/write-access matrix
// against real PostgreSQL and the real Razorpay adapter (local stand-in).
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSeatAvailable,
  cancelPaidSubscription,
  changeSubscriptionSeats,
  getBillingOverview,
  getBillingSummary,
  getSeatStatus,
  ingestBillingWebhook,
  reconcileSubscription,
  requireBillingWriteAccess,
  saveBillingProfile,
  withSeatLock,
} from "../../../services/api/src/core/billing/index.js";
import { createBillingKit, expectCode, subscribeStandard } from "./billing-kit.mjs";

test("subscription lifecycle: seats, cancellation, reconciliation, entitlements", async (t) => {
  const kit = await createBillingKit();
  const seats = (org, users) => kit.withRuntime((client) => changeSubscriptionSeats(client, org.ctx, { users }, kit.provider));
  const cancel = (org) => kit.withRuntime((client) => cancelPaidSubscription(client, org.ctx, kit.provider));
  const writeAccess = (org) => kit.withRuntime((client) => requireBillingWriteAccess(client, org.organizationId, kit.env));
  const deliver = (signed) => kit.withRuntime((client) => ingestBillingWebhook(client, { rawBody: signed.body, signature: signed.signature, eventIdHeader: signed.eventId }, kit.provider));
  const changes = async (org) => (await kit.owner.query(`SELECT * FROM billing_seat_changes WHERE organization_id=$1 ORDER BY created_at`, [org.organizationId])).rows;
  const later = (seconds) => Math.floor(Date.now() / 1000) + seconds;

  try {
    await t.test("Free: 1 included user; the second user is refused in enforce mode; pending invitations count once per email", async () => {
      const org = await kit.organization({ members: 1 });
      const status = await kit.withRuntime((client) => getSeatStatus(client, org.organizationId));
      assert.equal(status.capacity, 1);
      assert.equal(status.used, 1);
      await assert.rejects(kit.withRuntime((client) => assertSeatAvailable(client, org.organizationId, { env: kit.env })), expectCode("BILLING_SEAT_LIMIT"));
      assert.ok((await kit.withRuntime((client) => assertSeatAvailable(client, org.organizationId, { env: { BILLING_ENFORCEMENT_MODE: "observe" } }))).wouldBlock);
      // Duplicate pending rows for one email, a revoked and an expired invitation count once / not at all.
      const email = `dup-${org.organizationId}@test.invalid`;
      for (const [suffix, extra] of [["a", ""], ["b", ""], ["c", ", revoked_at = now()"], ["d", ", expires_at = now() - interval '1 day'"]]) {
        const id = (await kit.owner.query(
          `INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at) VALUES (gen_random_uuid(),$1,$2,'member',$3,$4, now() + interval '7 days') RETURNING id`,
          [org.organizationId, suffix === "c" || suffix === "d" ? `${suffix}-${email}` : email, `tok-${suffix}-${org.organizationId}`, org.ownerId],
        )).rows[0].id;
        if (extra) await kit.owner.query(`UPDATE organization_invitations SET ${extra.slice(2)} WHERE id=$1`, [id]);
      }
      assert.equal((await kit.withRuntime((client) => getSeatStatus(client, org.organizationId))).pendingInvitations, 1);
    });

    await t.test("adding users: provider-confirmed, then capacity rises; rejection leaves users unchanged", async () => {
      const org = await kit.organization({ members: 2 });
      const checkout = await subscribeStandard(kit, org, 3);
      const result = await seats(org, 5);
      assert.equal(result.state, "applied");
      assert.equal(kit.standin.subscriptions.get(checkout.providerSubscriptionId).quantity, 4);
      assert.equal((await kit.subscription(org.organizationId)).paid_seats, 4);
      assert.equal((await changes(org)).at(-1).status, "applied");
      kit.standin.failNext("PATCH", /\/subscriptions\//, { mode: "status", status: 400, payload: { error: { description: "not allowed" } } });
      await assert.rejects(seats(org, 7), expectCode("BILLING_SEAT_CHANGE_REJECTED"));
      assert.equal((await kit.subscription(org.organizationId)).paid_seats, 4);
      assert.equal((await changes(org)).at(-1).status, "failed");
    });

    await t.test("provider applied the increase but the response was lost: pending, then the worker confirms it", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      kit.standin.failNext("PATCH", /\/subscriptions\//, { mode: "applyThenDrop" });
      const result = await seats(org, 4);
      assert.equal(result.state, "pending");
      assert.equal((await kit.subscription(org.organizationId)).paid_seats, 1, "no capacity before confirmation");
      assert.equal(kit.standin.subscriptions.get(checkout.providerSubscriptionId).quantity, 3, "the provider did apply it");
      await assert.rejects(seats(org, 6), expectCode("BILLING_CHANGE_IN_PROGRESS"));
      await kit.owner.query(`UPDATE billing_seat_changes SET next_attempt_at = now() - interval '1 second' WHERE organization_id=$1 AND status='provider_pending'`, [org.organizationId]);
      await kit.maintenance(["seats"]);
      assert.equal((await kit.subscription(org.organizationId)).paid_seats, 3);
      assert.equal(kit.standin.subscriptions.get(checkout.providerSubscriptionId).quantity, 3, "re-issuing an absolute quantity never double-applies");
    });

    await t.test("concurrent increases: serialised, provider and local capacity agree, no lost update", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      const results = await Promise.allSettled([seats(org, 4), seats(org, 6)]);
      for (const refused of results.filter((r) => r.status === "rejected")) {
        assert.ok(["BILLING_CHANGE_IN_PROGRESS", "BILLING_NO_CHANGE"].includes(refused.reason.code), refused.reason.message);
      }
      assert.ok(results.some((r) => r.status === "fulfilled"));
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.paid_seats, kit.standin.subscriptions.get(checkout.providerSubscriptionId).quantity, "local capacity equals what the provider bills");
      // Every applied change starts where the previous one ended: nothing was lost.
      const applied = (await changes(org)).filter((c) => c.status === "applied");
      for (let i = 1; i < applied.length; i += 1) assert.equal(applied[i].from_paid_seats, applied[i - 1].to_paid_seats);
      assert.equal(applied.at(-1).to_paid_seats, sub.paid_seats);
    });

    await t.test("seat increase racing an invitation: the invitation only sees confirmed capacity", async () => {
      const org = await kit.organization({ members: 2 });
      await subscribeStandard(kit, org, 2);
      kit.standin.failNext("PATCH", /\/subscriptions\//, { mode: "drop" });
      await seats(org, 3); // outcome unknown: capacity must not rise yet
      await assert.rejects(
        kit.withRuntime((client) => withSeatLock(client, org.organizationId, () => assertSeatAvailable(client, org.organizationId, { env: kit.env }))),
        expectCode("BILLING_SEAT_LIMIT"),
      );
    });

    await t.test("reduction: never below usage; scheduled for renewal; applied when the renewal shows the new quantity", async () => {
      const org = await kit.organization({ members: 3 });
      const checkout = await subscribeStandard(kit, org, 6);
      await assert.rejects(seats(org, 2), expectCode("BILLING_USERS_BELOW_USAGE"));
      const result = await seats(org, 4);
      assert.equal(result.state, "scheduled");
      let sub = await kit.subscription(org.organizationId);
      assert.equal(sub.paid_seats, 5, "keeps what was paid for until renewal");
      assert.equal(sub.pending_paid_seats, 3);
      assert.equal(kit.standin.subscriptions.get(checkout.providerSubscriptionId).quantity, 5);
      await assert.rejects(seats(org, 3), expectCode("BILLING_REDUCTION_SCHEDULED"));
      // A mid-cycle update event with the old quantity changes nothing.
      await deliver(kit.standin.webhook("subscription.updated", checkout.providerSubscriptionId, {}, later(1)));
      await kit.maintenance(["webhooks"]);
      assert.equal((await kit.subscription(org.organizationId)).paid_seats, 5);
      // Renewal: new cycle with the scheduled quantity.
      kit.standin.renew(checkout.providerSubscriptionId);
      await deliver(kit.standin.webhook("subscription.charged", checkout.providerSubscriptionId, {}, later(2)));
      await kit.maintenance(["webhooks"]);
      sub = await kit.subscription(org.organizationId);
      assert.equal(sub.paid_seats, 3);
      assert.equal(sub.pending_paid_seats, null);
      assert.equal((await changes(org)).at(-1).status, "applied");
    });

    await t.test("keeping current users cancels the scheduled reduction at the provider", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 4);
      await seats(org, 2);
      assert.ok(kit.standin.subscriptions.get(checkout.providerSubscriptionId).scheduled);
      const result = await seats(org, 4);
      assert.equal(result.state, "applied");
      assert.equal(kit.standin.subscriptions.get(checkout.providerSubscriptionId).scheduled, null);
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.pending_paid_seats, null);
      assert.equal(sub.paid_seats, 3);
    });

    await t.test("cancel at renewal: scheduled, duplicate request is idempotent, access continues, cancellation webhook moves to Free", async () => {
      const org = await kit.organization({ members: 3 });
      const checkout = await subscribeStandard(kit, org, 3);
      const first = await cancel(org);
      assert.equal(first.state, "scheduled");
      const again = await cancel(org);
      assert.equal(again.alreadyScheduled, true);
      assert.equal(kit.standin.requests.filter((r) => r.path.endsWith("/cancel")).filter((r) => r.path.includes(checkout.providerSubscriptionId)).length, 1);
      assert.equal((await writeAccess(org)).writeAccess, true, "service continues until the period ends");
      await assert.rejects(seats(org, 5), expectCode("BILLING_CANCELLING"));
      const overview = await kit.withRuntime((client) => getBillingOverview(client, org.organizationId, kit.env));
      assert.equal(overview.subscription.state, "cancel_at_cycle_end");
      kit.standin.renew(checkout.providerSubscriptionId); // period ends -> provider cancels
      await deliver(kit.standin.webhook("subscription.cancelled", checkout.providerSubscriptionId, {}, later(3)));
      await kit.maintenance(["webhooks"]);
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.plan_code, "free");
      assert.equal(sub.included_users_snapshot, 1);
      assert.ok(sub.seat_overage_since, "3 users on Free starts the grace period");
      assert.equal((await writeAccess(org)).writeAccess, true, "writes continue during the overage grace");
    });

    await t.test("cancellation outcome unknown: pending, then the worker confirms", async () => {
      const org = await kit.organization();
      await subscribeStandard(kit, org, 2);
      kit.standin.failNext("POST", /\/cancel$/, { mode: "applyThenDrop" });
      assert.equal((await cancel(org)).state, "pending");
      await kit.owner.query(`UPDATE organization_subscriptions SET cancel_next_attempt_at = now() - interval '1 second' WHERE organization_id=$1`, [org.organizationId]);
      await kit.maintenance(["cancellations"]);
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.cancel_at_cycle_end, true);
      assert.equal(sub.cancellation_state, "scheduled");
    });

    await t.test("past due: writes during grace, blocked after; Billing and user removal still work", async () => {
      const org = await kit.organization({ members: 2 });
      const checkout = await subscribeStandard(kit, org, 2);
      kit.standin.setStatus(checkout.providerSubscriptionId, "pending");
      await deliver(kit.standin.webhook("subscription.pending", checkout.providerSubscriptionId, {}, later(1)));
      await kit.maintenance(["webhooks"]);
      assert.equal((await kit.subscription(org.organizationId)).status, "past_due");
      assert.equal((await writeAccess(org)).writeAccess, true, "inside the grace period");
      await kit.owner.query(`UPDATE organization_subscriptions SET grace_ends_at = now() - interval '1 minute' WHERE organization_id=$1`, [org.organizationId]);
      await assert.rejects(writeAccess(org), expectCode("ENTITLEMENT_SUBSCRIPTION_INACTIVE"));
      // Billing still works: overview, profile, refresh.
      const overview = await kit.withRuntime((client) => getBillingOverview(client, org.organizationId, kit.env));
      assert.equal(overview.subscription.state, "past_due");
      await kit.withRuntime((client) => saveBillingProfile(client, org.ctx, { legalName: "Org Pvt Ltd", billingEmail: "billing@example.com", addressLine1: "1 Road", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "IN", gstin: "27AAPFU0939F1ZV" }));
      const customer = (await kit.owner.query(`SELECT state_code, gstin FROM billing_customers WHERE organization_id=$1`, [org.organizationId])).rows[0];
      assert.equal(customer.state_code, "27");
      // The provider recovers the payment.
      kit.standin.setStatus(checkout.providerSubscriptionId, "active");
      await deliver(kit.standin.webhook("subscription.charged", checkout.providerSubscriptionId, {}, later(2)));
      await kit.maintenance(["webhooks"]);
      assert.equal((await writeAccess(org)).writeAccess, true);
    });

    await t.test("seat overage after grace: business writes blocked; removing users restores access", async () => {
      const org = await kit.organization({ members: 2 });
      const { reconcileSeatOverage } = await import("../../../services/api/src/core/billing/index.js");
      await kit.withRuntime((client) => reconcileSeatOverage(client, org.organizationId));
      await kit.owner.query(`UPDATE organization_subscriptions SET seat_overage_since = now() - interval '15 days' WHERE organization_id=$1`, [org.organizationId]);
      await assert.rejects(writeAccess(org), expectCode("ENTITLEMENT_SEAT_OVERAGE"));
      await kit.owner.query(`UPDATE organization_memberships SET status='disabled' WHERE organization_id=$1 AND user_id=$2`, [org.organizationId, org.memberIds[1]]);
      await kit.withRuntime((client) => reconcileSeatOverage(client, org.organizationId));
      assert.equal((await writeAccess(org)).writeAccess, true);
    });

    await t.test("reconciliation repairs drift, refuses a provider object that does not belong to the organisation", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      kit.standin.setStatus(checkout.providerSubscriptionId, "halted"); // missed webhook
      const result = await kit.withRuntime((client) => reconcileSubscription(client, org.organizationId, kit.provider));
      assert.equal(result.reconciled, true);
      assert.equal((await kit.subscription(org.organizationId)).status, "halted");
      kit.standin.setStatus(checkout.providerSubscriptionId, "active");
      await kit.withRuntime((client) => reconcileSubscription(client, org.organizationId, kit.provider));
      assert.equal((await kit.subscription(org.organizationId)).status, "active");
      // Wrong organisation in the provider notes: flagged, not applied.
      kit.standin.subscriptions.get(checkout.providerSubscriptionId).notes.vercentlabs_organization_id = "00000000-0000-0000-0000-000000000000";
      kit.standin.setStatus(checkout.providerSubscriptionId, "cancelled");
      const mismatch = await kit.withRuntime((client) => reconcileSubscription(client, org.organizationId, kit.provider));
      assert.equal(mismatch.reason, "mismatch");
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.plan_code, "standard", "not reverted on the word of a mismatched object");
      assert.ok(sub.reconciliation_required_at);
      // Scheduled worker reconciliation picks up flagged subscriptions without crashing.
      await kit.owner.query(`UPDATE organization_subscriptions SET last_provider_sync_at = now() - interval '2 days' WHERE organization_id=$1`, [org.organizationId]);
      const pass = await kit.maintenance(["reconciliation"]);
      assert.ok(pass.reconciliations >= 1);
    });
  } finally {
    await kit.close();
  }
});
