// Webhook ingestion (edge) and leased worker processing against real PostgreSQL.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";

import {
  applyWebhookEventInTx,
  claimWebhookEvents,
  getBillingSummary,
  ingestBillingWebhook,
  MAX_WEBHOOK_ATTEMPTS,
  MAX_WEBHOOK_BODY_BYTES,
  processClaimedWebhookEvent,
} from "../../../services/api/src/core/billing/index.js";
import { createBillingKit, expectCode, PREVIOUS_WEBHOOK_SECRET, subscribeStandard, WEBHOOK_SECRET } from "./billing-kit.mjs";

const sign = (body, secret = WEBHOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

test("billing webhooks: ingestion, leasing, retries, ordering and trust", async (t) => {
  const kit = await createBillingKit();
  const ingest = (input) => kit.withRuntime((client) => ingestBillingWebhook(client, input, kit.provider));
  const deliver = async (signed) => ingest({ rawBody: signed.body, signature: signed.signature, eventIdHeader: signed.eventId });
  const eventRow = async (eventId) => (await kit.owner.query(`SELECT * FROM billing_webhook_events WHERE provider_event_id=$1`, [eventId])).rows[0];

  try {
    await t.test("signature: exact raw body, current and previous secret; wrong, missing, modified and oversized bodies refused", async () => {
      const body = JSON.stringify({ entity: "event", event: "payment.authorized", payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}` } } }, created_at: 1_700_000_000 });
      assert.equal((await ingest({ rawBody: body, signature: sign(body), eventIdHeader: `evt_${randomUUID().slice(0, 12)}` })).duplicate, false);
      assert.equal((await ingest({ rawBody: body, signature: sign(body, PREVIOUS_WEBHOOK_SECRET), eventIdHeader: `evt_${randomUUID().slice(0, 12)}` })).duplicate, false, "previous secret accepted during rotation");
      await assert.rejects(ingest({ rawBody: body, signature: sign(body, "wrong"), eventIdHeader: "evt_x1" }), expectCode("BILLING_WEBHOOK_SIGNATURE_INVALID"));
      await assert.rejects(ingest({ rawBody: body, signature: null, eventIdHeader: "evt_x2" }), expectCode("BILLING_WEBHOOK_SIGNATURE_INVALID"));
      await assert.rejects(ingest({ rawBody: `${body} `, signature: sign(body), eventIdHeader: "evt_x3" }), expectCode("BILLING_WEBHOOK_SIGNATURE_INVALID"), "one extra byte breaks the signature");
      const reformatted = JSON.stringify(JSON.parse(body), null, 2);
      await assert.rejects(ingest({ rawBody: reformatted, signature: sign(body), eventIdHeader: "evt_x4" }), expectCode("BILLING_WEBHOOK_SIGNATURE_INVALID"), "re-serialised JSON is not the raw body");
      const huge = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
      await assert.rejects(ingest({ rawBody: huge, signature: sign(huge), eventIdHeader: "evt_x5" }), expectCode("BILLING_WEBHOOK_TOO_LARGE"));
      const malformed = "{not json";
      await assert.rejects(ingest({ rawBody: malformed, signature: sign(malformed), eventIdHeader: "evt_x6" }), expectCode("BILLING_WEBHOOK_INVALID"));
      const noType = JSON.stringify({ payload: {} });
      await assert.rejects(ingest({ rawBody: noType, signature: sign(noType), eventIdHeader: "evt_x7" }), expectCode("BILLING_WEBHOOK_INVALID"));
      const badPayload = JSON.stringify({ event: "subscription.activated", payload: { subscription: "nope" }, created_at: 1 });
      await assert.rejects(ingest({ rawBody: badPayload, signature: sign(badPayload), eventIdHeader: "evt_x8" }), expectCode("BILLING_WEBHOOK_INVALID"));
      for (const id of ["evt_x1", "evt_x2", "evt_x3", "evt_x4", "evt_x5", "evt_x6", "evt_x7", "evt_x8"]) assert.equal(await eventRow(id), undefined, "nothing unauthenticated or malformed is persisted");
    });

    await t.test("ingestion stores a minimised payload, no signature, and deduplicates by provider event id", async () => {
      const eventId = `evt_${randomUUID().slice(0, 12)}`;
      const body = JSON.stringify({
        entity: "event", event: "payment.captured", created_at: 1_700_000_100,
        payload: { payment: { entity: { id: "pay_min1", amount: 100000, currency: "INR", status: "captured", method: "card", email: "someone@example.com", contact: "+919999999999", card: { last4: "4242", network: "Visa" }, vpa: "someone@upi" } } },
      });
      assert.equal((await ingest({ rawBody: body, signature: sign(body), eventIdHeader: eventId })).duplicate, false);
      assert.equal((await ingest({ rawBody: body, signature: sign(body), eventIdHeader: eventId })).duplicate, true);
      const row = await eventRow(eventId);
      assert.equal(row.signature, null);
      assert.equal(row.signature_value, null);
      assert.equal(row.processing_status, "received");
      assert.equal(row.event_id_source, "header");
      const stored = JSON.stringify(row.payload);
      for (const secret of ["someone@example.com", "9999999999", "4242", "someone@upi"]) assert.ok(!stored.includes(secret), `payload must not keep ${secret}`);
      // Without the header a deterministic fallback id still deduplicates.
      const fallbackBody = JSON.stringify({ event: "payment.failed", created_at: 1_700_000_200, payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}` } } } });
      const first = await ingest({ rawBody: fallbackBody, signature: sign(fallbackBody), eventIdHeader: null });
      const second = await ingest({ rawBody: fallbackBody, signature: sign(fallbackBody), eventIdHeader: "bad id with spaces" });
      assert.equal(first.eventId, second.eventId);
      assert.equal(second.duplicate, true);
      assert.equal((await eventRow(first.eventId)).event_id_source, "derived");
    });

    await t.test("two workers claiming at once never share an event; each event is applied once", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 3);
      const ids = [];
      for (let i = 0; i < 6; i += 1) {
        const signed = kit.standin.webhook("subscription.charged", checkout.providerSubscriptionId, {
          payment: { entity: { id: `pay_c${i}_${randomUUID().slice(0, 6)}`, amount: 200000, currency: "INR", status: "captured", method: "upi", created_at: 1_700_000_000 + i } },
        });
        await deliver(signed);
        ids.push(signed.eventId);
      }
      const [a, b] = await Promise.all([
        kit.withRuntime((client) => claimWebhookEvents(client, { workerId: "worker-a", limit: 50, leaseSeconds: 60 })),
        kit.withRuntime((client) => claimWebhookEvents(client, { workerId: "worker-b", limit: 50, leaseSeconds: 60 })),
      ]);
      const ours = (rows) => rows.filter((row) => ids.includes(row.provider_event_id)).map((row) => row.id);
      const claimedA = ours(a);
      const claimedB = ours(b);
      assert.equal(claimedA.filter((id) => claimedB.includes(id)).length, 0, "disjoint claims");
      assert.equal(claimedA.length + claimedB.length, 6);
      for (const row of [...a, ...b]) await kit.withRuntime((client) => processClaimedWebhookEvent(client, row, row.processing_owner));
      const payments = (await kit.owner.query(`SELECT count(*)::int AS n FROM billing_payments WHERE organization_id=$1`, [org.organizationId])).rows[0].n;
      assert.equal(payments, 6);
      for (const id of ids) assert.equal((await eventRow(id)).processing_status, "processed");
    });

    await t.test("an expired lease is reclaimed; the crashed worker can no longer finalise", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      kit.standin.setStatus(checkout.providerSubscriptionId, "pending"); // the entity status is what we apply
      const signed = kit.standin.webhook("subscription.pending", checkout.providerSubscriptionId);
      await deliver(signed);
      const [claimed] = (await kit.withRuntime((client) => claimWebhookEvents(client, { workerId: "crashed", limit: 50, leaseSeconds: 60 }))).filter((row) => row.provider_event_id === signed.eventId);
      assert.ok(claimed);
      // The "crashed" worker's lease runs out.
      await kit.owner.query(`UPDATE billing_webhook_events SET processing_lease_expires_at = now() - interval '1 second' WHERE id=$1`, [claimed.id]);
      const [reclaimed] = (await kit.withRuntime((client) => claimWebhookEvents(client, { workerId: "rescuer", limit: 50, leaseSeconds: 60 }))).filter((row) => row.id === claimed.id);
      assert.equal(reclaimed.processing_owner, "rescuer");
      assert.equal(reclaimed.processing_attempts, 2);
      assert.equal(await kit.withRuntime((client) => processClaimedWebhookEvent(client, claimed, "crashed")), "lost_lease");
      assert.equal(await kit.withRuntime((client) => processClaimedWebhookEvent(client, reclaimed, "rescuer")), "processed");
      assert.equal((await kit.subscription(org.organizationId)).status, "past_due");
    });

    await t.test("processing failure: bounded backoff, then dead letter; dead letters stay inspectable", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      const signed = kit.standin.webhook("subscription.activated", checkout.providerSubscriptionId);
      await deliver(signed);
      // Make processing fail deterministically: lock the subscription row from another session.
      const blocker = await kit.pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(`SELECT 1 FROM organization_subscriptions WHERE organization_id=$1 FOR UPDATE`, [org.organizationId]);
      try {
        for (let attempt = 1; attempt <= MAX_WEBHOOK_ATTEMPTS; attempt += 1) {
          await kit.owner.query(`UPDATE billing_webhook_events SET next_attempt_at = now() - interval '1 second' WHERE provider_event_id=$1`, [signed.eventId]);
          const rows = (await kit.withRuntime((client) => claimWebhookEvents(client, { workerId: "w", limit: 50, leaseSeconds: 60 }))).filter((row) => row.provider_event_id === signed.eventId);
          assert.equal(rows.length, 1);
          await kit.withRuntime(async (client) => {
            await client.query("SET lock_timeout = '100ms'");
            return processClaimedWebhookEvent(client, rows[0], "w").finally(() => client.query("RESET lock_timeout"));
          });
          const row = await eventRow(signed.eventId);
          if (attempt < MAX_WEBHOOK_ATTEMPTS) {
            assert.equal(row.processing_status, "failed");
            assert.ok(new Date(row.next_attempt_at) > new Date(), "retry scheduled in the future");
          }
        }
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const dead = await eventRow(signed.eventId);
      assert.equal(dead.processing_status, "dead_lettered");
      assert.ok(dead.dead_lettered_at);
      assert.equal(dead.processing_attempts, MAX_WEBHOOK_ATTEMPTS);
      assert.ok(dead.processing_error && !dead.processing_error.includes(WEBHOOK_SECRET));
      const reclaim = (await kit.withRuntime((client) => claimWebhookEvents(client, { workerId: "w", limit: 50, leaseSeconds: 60 }))).filter((row) => row.id === dead.id);
      assert.equal(reclaim.length, 0, "dead letters are never retried automatically");
    });

    await t.test("out of order: an older event never overwrites newer state or resurrects a cancelled subscription", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      const t0 = Math.floor(Date.now() / 1000);
      kit.standin.setStatus(checkout.providerSubscriptionId, "active");
      const newerActive = kit.standin.webhook("subscription.activated", checkout.providerSubscriptionId, {}, t0 + 100);
      kit.standin.setStatus(checkout.providerSubscriptionId, "pending");
      const olderPending = kit.standin.webhook("subscription.pending", checkout.providerSubscriptionId, {}, t0 + 50);
      await deliver(newerActive);
      await kit.maintenance(["webhooks"]);
      await deliver(olderPending); // delivered late, after the newer event was applied
      await kit.maintenance(["webhooks"]);
      assert.equal((await kit.subscription(org.organizationId)).status, "active", "older pending ignored");
      assert.match((await eventRow(olderPending.eventId)).processing_error, /stale_event/);

      kit.standin.setStatus(checkout.providerSubscriptionId, "cancelled");
      await deliver(kit.standin.webhook("subscription.cancelled", checkout.providerSubscriptionId, {}, t0 + 200));
      await kit.maintenance(["webhooks"]);
      assert.equal((await kit.subscription(org.organizationId)).plan_code, "free");
      kit.standin.setStatus(checkout.providerSubscriptionId, "active");
      const lateActive = kit.standin.webhook("subscription.activated", checkout.providerSubscriptionId, {}, t0 + 150);
      await deliver(lateActive);
      await kit.maintenance(["webhooks"]);
      const after = await kit.subscription(org.organizationId);
      assert.equal(after.plan_code, "free", "a cancelled subscription is not resurrected");
      assert.equal(after.provider_subscription_id, null);
    });

    await t.test("cross-organisation: a provider object can only affect the organisation our records map it to", async () => {
      const victim = await kit.organization();
      const attacker = await kit.organization();
      const attackerCheckout = await subscribeStandard(kit, attacker, 2);
      // A genuinely signed event for the attacker's subscription whose notes claim the victim.
      const sub = kit.standin.subscriptions.get(attackerCheckout.providerSubscriptionId);
      sub.notes = { ...sub.notes, vercentlabs_organization_id: victim.organizationId };
      sub.status = "halted";
      await deliver(kit.standin.webhook("subscription.halted", attackerCheckout.providerSubscriptionId));
      await kit.maintenance(["webhooks"]);
      assert.equal((await kit.subscription(victim.organizationId)).status, "active", "victim untouched");
      assert.equal((await kit.subscription(attacker.organizationId)).status, "halted", "mapped by provider subscription id, not by notes");

      // An unknown provider subscription whose notes name the victim is ignored, not applied.
      const stray = kit.standin.subscriptions.get((await kit.provider.createSubscription({ plan_id: sub.plan_id, total_count: 1, quantity: 9, notes: { vercentlabs_organization_id: victim.organizationId, vercentlabs_checkout_session_id: randomUUID() } })).id);
      stray.status = "active";
      const signed = kit.standin.webhook("subscription.activated", stray.id, {
        payment: { entity: { id: `pay_stray_${randomUUID().slice(0, 6)}`, amount: 900000, currency: "INR", status: "captured" } },
      });
      await deliver(signed);
      await kit.maintenance(["webhooks"]);
      const row = await eventRow(signed.eventId);
      assert.equal(row.processing_status, "ignored");
      assert.equal(row.organization_id, null);
      assert.match(row.processing_error, /not corroborated/);
      const victimSub = await kit.subscription(victim.organizationId);
      assert.equal(victimSub.plan_code, "free");
      assert.equal((await kit.owner.query(`SELECT count(*)::int AS n FROM billing_payments WHERE organization_id=$1`, [victim.organizationId])).rows[0].n, 0);
    });

    await t.test("unknown events are stored and ignored safely; halted stops business writes", async () => {
      const unknown = JSON.stringify({ event: "order.paid", created_at: 1_700_000_300, payload: { order: { entity: { id: "order_1" } } } });
      const id = `evt_${randomUUID().slice(0, 12)}`;
      await ingest({ rawBody: unknown, signature: sign(unknown), eventIdHeader: id });
      await kit.maintenance(["webhooks"]);
      assert.equal((await eventRow(id)).processing_status, "ignored");

      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      kit.standin.setStatus(checkout.providerSubscriptionId, "halted");
      await deliver(kit.standin.webhook("subscription.halted", checkout.providerSubscriptionId));
      await kit.maintenance(["webhooks"]);
      const summary = await kit.withRuntime((client) => getBillingSummary(client, org.organizationId, kit.env));
      assert.equal(summary.writeAccess, false);
    });

    await t.test("ledger: payments, provider invoices and refunds are recorded without instrument data", async () => {
      const org = await kit.organization();
      const checkout = await subscribeStandard(kit, org, 2);
      const paymentId = `pay_l_${randomUUID().slice(0, 6)}`;
      const invoiceId = `inv_l_${randomUUID().slice(0, 6)}`;
      await deliver(
        kit.standin.webhook("subscription.charged", checkout.providerSubscriptionId, {
          payment: { entity: { id: paymentId, amount: 100000, fee: 2360, tax: 360, currency: "INR", status: "captured", method: "card", invoice_id: invoiceId, card: { last4: "1111" }, created_at: 1_700_000_000 } },
        }),
      );
      const invoiceBody = JSON.stringify({
        event: "invoice.paid", created_at: Math.floor(Date.now() / 1000),
        payload: { invoice: { entity: { id: invoiceId, subscription_id: checkout.providerSubscriptionId, amount: 100000, amount_paid: 100000, status: "paid", short_url: "https://rzp.io/i/abc", issued_at: 1_700_000_000 } } },
      });
      await ingest({ rawBody: invoiceBody, signature: sign(invoiceBody), eventIdHeader: `evt_${randomUUID().slice(0, 12)}` });
      const refundBody = JSON.stringify({ event: "refund.processed", created_at: Math.floor(Date.now() / 1000), payload: { refund: { entity: { id: "rfnd_1", payment_id: paymentId, amount: 40000, status: "processed" } } } });
      await ingest({ rawBody: refundBody, signature: sign(refundBody), eventIdHeader: `evt_${randomUUID().slice(0, 12)}` });
      await kit.maintenance(["webhooks"]);
      const payment = (await kit.owner.query(`SELECT * FROM billing_payments WHERE provider_payment_id=$1`, [paymentId])).rows[0];
      assert.equal(Number(payment.amount_paise), 100000);
      assert.equal(Number(payment.fee_paise), 2360);
      assert.equal(Number(payment.amount_refunded_paise), 40000);
      assert.equal(payment.refund_status, "partial");
      assert.ok(!JSON.stringify(payment.provider_snapshot).includes("1111"));
      const invoice = (await kit.owner.query(`SELECT * FROM billing_invoices WHERE provider_invoice_id=$1`, [invoiceId])).rows[0];
      assert.equal(invoice.organization_id, org.organizationId);
      assert.equal(invoice.document_kind, "provider_invoice");
      assert.equal(invoice.invoice_url, "https://rzp.io/i/abc");
    });

    await t.test("applyWebhookEventInTx is pure DB work (no provider calls)", async () => {
      const before = kit.standin.requests.length;
      await kit.withRuntime(async (client) => {
        await client.query("BEGIN");
        try {
          await applyWebhookEventInTx(client, { event: "subscription.activated", created_at: 1, payload: { subscription: { entity: { id: "sub_unknown", status: "active" } } } });
        } finally {
          await client.query("ROLLBACK");
        }
      });
      assert.equal(kit.standin.requests.length, before);
    });
  } finally {
    await kit.close();
  }
});
