// Provider webhooks: fast ingestion in the request, processing in the worker.
//
//   POST /api/billing/webhook -> size limit -> exact raw-body HMAC (current or
//   previous secret) -> envelope validation -> durable, deduplicated INSERT of a
//   minimised payload -> 2xx.
//   Worker -> claim due rows with a lease (FOR UPDATE SKIP LOCKED) -> apply inside
//   one transaction that holds the row lock and checks lease ownership ->
//   processed / ignored, or failed with bounded backoff -> dead_lettered.
//
// Organisation resolution only trusts OUR mappings (provider subscription,
// checkout session, payment, invoice). A provider note naming an organisation
// is a recovery clue, used only when it matches one of our own pending
// checkout intents for the same plan; otherwise the event is ignored.
import { createHash } from "node:crypto";

import { applyCheckoutEntityInTx } from "./checkout.js";
import { BillingServiceError, redactedErrorText } from "./errors.js";
import { billingEvent } from "./observability.js";
import { recordRefundInTx, upsertInvoiceInTx, upsertPaymentInTx } from "./payments.js";
import { mapProviderSubscriptionStatus, TERMINAL_STATUSES } from "./state.js";
import { applySubscriptionEntityInTx } from "./subscriptions.js";
import { epoch, tx } from "./shared.js";

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
export const MAX_WEBHOOK_ATTEMPTS = 8;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const EVENT_TYPE = /^[a-z_]{1,40}\.[a-z_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bounded exponential backoff: 1, 2, 4, 8, 16, 32, 60, 60 minutes.
export function webhookRetryDelayMinutes(attempts) {
  return Math.min(60, 2 ** Math.max(0, Number(attempts) - 1));
}

export function parseWebhookEnvelope(rawBody) {
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new BillingServiceError(400, "The webhook body is not valid JSON.", "BILLING_WEBHOOK_INVALID");
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new BillingServiceError(400, "The webhook body is not an event.", "BILLING_WEBHOOK_INVALID");
  if (typeof event.event !== "string" || !EVENT_TYPE.test(event.event)) throw new BillingServiceError(400, "The webhook has no valid event type.", "BILLING_WEBHOOK_INVALID");
  if (event.created_at !== undefined && (!Number.isSafeInteger(event.created_at) || event.created_at <= 0)) {
    throw new BillingServiceError(400, "The webhook timestamp is not valid.", "BILLING_WEBHOOK_INVALID");
  }
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new BillingServiceError(400, "The webhook has no payload.", "BILLING_WEBHOOK_INVALID");
  for (const [name, wrapper] of Object.entries(event.payload)) {
    if (wrapper !== null && (typeof wrapper !== "object" || Array.isArray(wrapper))) throw new BillingServiceError(400, `The webhook ${name} entity is malformed.`, "BILLING_WEBHOOK_INVALID");
  }
  return event;
}

const pick = (source, keys) => {
  if (!source || typeof source !== "object") return null;
  const out = {};
  for (const key of keys) {
    const value = source[key];
    if (value === undefined) continue;
    if (value === null || typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, 500);
  }
  return out;
};

function vercentlabsNotes(notes) {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return {};
  return Object.fromEntries(Object.entries(notes).filter(([key, value]) => key.startsWith("vercentlabs_") && typeof value === "string").map(([key, value]) => [key, value.slice(0, 100)]));
}

// Only what billing needs is persisted: no customer contact data, no instrument details.
export function sanitizeWebhookEvent(event) {
  const payload = event.payload || {};
  const subscription = pick(payload.subscription?.entity, [
    "id", "entity", "plan_id", "status", "quantity", "current_start", "current_end", "charge_at", "start_at", "end_at", "ended_at",
    "paid_count", "remaining_count", "has_scheduled_changes", "change_scheduled_at", "created_at",
  ]);
  if (subscription) subscription.notes = vercentlabsNotes(payload.subscription.entity.notes);
  const payment = pick(payload.payment?.entity, [
    "id", "entity", "amount", "currency", "status", "method", "fee", "tax", "invoice_id", "order_id", "captured", "amount_refunded", "refund_status", "error_code", "created_at",
  ]);
  const invoice = pick(payload.invoice?.entity, [
    "id", "entity", "subscription_id", "payment_id", "amount", "amount_due", "amount_paid", "tax_amount", "currency", "status", "short_url",
    "issued_at", "paid_at", "created_at", "billing_start", "billing_end",
  ]);
  const refund = pick(payload.refund?.entity, ["id", "entity", "payment_id", "amount", "currency", "status", "created_at"]);
  const out = {};
  if (subscription) out.subscription = { entity: subscription };
  if (payment) out.payment = { entity: payment };
  if (invoice) out.invoice = { entity: invoice };
  if (refund) out.refund = { entity: refund };
  return { entity: "event", event: event.event, created_at: event.created_at ?? null, contains: Array.isArray(event.contains) ? event.contains.slice(0, 10).map(String) : [], payload: out };
}

function derivedEventId(event) {
  const p = event.payload || {};
  const key = [event.event, event.created_at, p.subscription?.entity?.id, p.payment?.entity?.id, p.invoice?.entity?.id, p.refund?.entity?.id, p.subscription?.entity?.status].join("|");
  return `derived_${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

// The HTTP edge. Nothing here changes a subscription.
export async function ingestBillingWebhook(client, { rawBody, signature, eventIdHeader }, provider) {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) throw new BillingServiceError(413, "The webhook body is too large.", "BILLING_WEBHOOK_TOO_LARGE");
  if (!signature || !provider.verifyWebhook(rawBody, signature)) {
    billingEvent("billing.webhook.rejected", { reason: signature ? "bad_signature" : "missing_signature" }, { reason: signature ? "bad_signature" : "missing_signature" });
    throw new BillingServiceError(401, "The webhook signature is invalid.", "BILLING_WEBHOOK_SIGNATURE_INVALID");
  }
  const event = parseWebhookEnvelope(rawBody);
  const headerId = typeof eventIdHeader === "string" && EVENT_ID.test(eventIdHeader) ? eventIdHeader : null;
  const eventId = headerId ?? derivedEventId(event);
  const inserted = await client.query(
    `INSERT INTO billing_webhook_events (provider_event_id, event_type, provider_created_at, payload, processing_status, next_attempt_at, event_id_source)
     VALUES ($1,$2,$3,$4::jsonb,'received', now(), $5) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
    [eventId, event.event, epoch(event.created_at), JSON.stringify(sanitizeWebhookEvent(event)), headerId ? "header" : "derived"],
  );
  const duplicate = !inserted.rows[0];
  billingEvent(duplicate ? "billing.webhook.duplicate" : "billing.webhook.received", { eventId, eventType: event.event }, { event_type: event.event });
  return { duplicate, eventId };
}

// ------------------------------------------------------------------ worker side
export async function claimWebhookEvents(client, { workerId, limit = 20, leaseSeconds = 120 }) {
  const claimed = await client.query(
    `UPDATE billing_webhook_events event SET processing_status='processing', processing_owner=$1, processing_started_at=now(),
            processing_lease_expires_at=now() + make_interval(secs => $3), processing_attempts=event.processing_attempts + 1, last_attempt_at=now()
      WHERE event.id IN (
        SELECT id FROM billing_webhook_events
         WHERE (processing_status IN ('received','failed') AND COALESCE(next_attempt_at, created_at) <= now())
            OR (processing_status = 'processing' AND processing_lease_expires_at < now())
         ORDER BY provider_created_at NULLS LAST, created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING event.*`,
    [workerId, limit, leaseSeconds],
  );
  // UPDATE ... RETURNING does not preserve the subquery order: process oldest provider events first.
  const at = (row) => new Date(row.provider_created_at ?? row.created_at).getTime();
  return claimed.rows.sort((a, b) => at(a) - at(b) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function processClaimedWebhookEvent(client, row, workerId) {
  try {
    const outcome = await tx(client, async () => {
      const owned = (
        await client.query(`SELECT id, payload FROM billing_webhook_events WHERE id=$1 AND processing_owner=$2 AND processing_status='processing' FOR UPDATE`, [row.id, workerId])
      ).rows[0];
      if (!owned) return { status: "lost_lease" };
      const result = await applyWebhookEventInTx(client, owned.payload);
      await client.query(
        `UPDATE billing_webhook_events SET processing_status=$2, organization_id=$3, processed_at=now(), processing_error=$4,
                processing_owner=NULL, processing_lease_expires_at=NULL, next_attempt_at=NULL WHERE id=$1`,
        [row.id, result.status, result.organizationId ?? null, result.note ?? null],
      );
      return result;
    });
    if (outcome.status !== "lost_lease") {
      billingEvent(outcome.status === "processed" ? "billing.webhook.processed" : "billing.webhook.ignored", { webhookEventId: row.id, eventType: row.event_type, note: outcome.note }, { event_type: row.event_type });
    }
    return outcome.status;
  } catch (error) {
    const attempts = Number(row.processing_attempts);
    const dead = attempts >= MAX_WEBHOOK_ATTEMPTS;
    await client.query(
      `UPDATE billing_webhook_events SET processing_status=$3, processing_error=$4, processing_owner=NULL, processing_lease_expires_at=NULL,
              next_attempt_at = CASE WHEN $5::boolean THEN NULL ELSE now() + make_interval(mins => $6) END,
              dead_lettered_at = CASE WHEN $5::boolean THEN now() ELSE NULL END
        WHERE id=$1 AND processing_owner=$2`,
      [row.id, workerId, dead ? "dead_lettered" : "failed", redactedErrorText(error), dead, webhookRetryDelayMinutes(attempts)],
    );
    billingEvent(dead ? "billing.webhook.dead_lettered" : "billing.webhook.failed", { webhookEventId: row.id, eventType: row.event_type, attempts, error: redactedErrorText(error) }, { event_type: row.event_type });
    return dead ? "dead_lettered" : "failed";
  }
}

async function resolveTarget(client, event) {
  const payload = event.payload || {};
  const subscription = payload.subscription?.entity;
  if (subscription?.id) {
    const current = (await client.query(`SELECT organization_id, id FROM organization_subscriptions WHERE provider_subscription_id=$1`, [subscription.id])).rows[0];
    if (current) return { organizationId: current.organization_id, localSubscriptionId: current.id, current: true };
    const session = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE provider_subscription_id=$1 FOR UPDATE`, [subscription.id])).rows[0];
    if (session) return { organizationId: session.organization_id, localSubscriptionId: session.subscription_id, session };
    // Corroborated recovery: the notes point at one of OUR checkout intents that
    // never recorded its provider id, for the same organisation and provider plan.
    const notes = subscription.notes || {};
    if (UUID.test(notes.vercentlabs_checkout_session_id || "") && UUID.test(notes.vercentlabs_organization_id || "")) {
      const pending = (
        await client.query(
          `SELECT * FROM billing_checkout_sessions WHERE id=$1 AND organization_id=$2 AND provider_subscription_id IS NULL AND expected_provider_plan_id=$3
              AND status IN ('provider_creating','provider_link_pending','provider_recovery_pending','cancel_pending') FOR UPDATE`,
          [notes.vercentlabs_checkout_session_id, notes.vercentlabs_organization_id, subscription.plan_id ?? null],
        )
      ).rows[0];
      if (pending) {
        await client.query(`UPDATE billing_checkout_sessions SET provider_subscription_id=$2, provider_linked_at=now(), provider_created_at=COALESCE(provider_created_at, now()) WHERE id=$1`, [pending.id, subscription.id]);
        pending.provider_subscription_id = subscription.id;
        return { organizationId: pending.organization_id, localSubscriptionId: pending.subscription_id, session: pending, recoveredLink: true };
      }
      return { organizationId: null, note: "unmatched provider subscription; organisation note not corroborated" };
    }
    return { organizationId: null, note: "unmatched provider subscription" };
  }
  const invoice = payload.invoice?.entity;
  if (invoice?.subscription_id) {
    const current = (await client.query(`SELECT organization_id, id FROM organization_subscriptions WHERE provider_subscription_id=$1`, [invoice.subscription_id])).rows[0]
      || (await client.query(`SELECT organization_id, subscription_id AS id FROM billing_checkout_sessions WHERE provider_subscription_id=$1`, [invoice.subscription_id])).rows[0];
    if (current) return { organizationId: current.organization_id, localSubscriptionId: current.id };
  }
  const payment = payload.payment?.entity;
  const paymentId = payment?.id || payload.refund?.entity?.payment_id;
  const invoiceId = payment?.invoice_id || invoice?.id;
  if (invoiceId) {
    const row = (await client.query(`SELECT organization_id, subscription_id FROM billing_invoices WHERE provider_invoice_id=$1`, [invoiceId])).rows[0];
    if (row) return { organizationId: row.organization_id, localSubscriptionId: row.subscription_id };
  }
  if (paymentId) {
    const row = (await client.query(`SELECT organization_id, subscription_id FROM billing_payments WHERE provider_payment_id=$1`, [paymentId])).rows[0];
    if (row) return { organizationId: row.organization_id, localSubscriptionId: row.subscription_id };
  }
  return { organizationId: null, note: "no known provider object" };
}

const ACTIVATING = ["authenticated", "active", "pending", "halted"];
// Payment/refund/invoice events may arrive before the event that introduces their
// payment or subscription (Razorpay does not guarantee order). They are retried
// for up to an hour, then ignored: an unrelated object on the same provider
// account must not pile up as dead letters.
const UNRESOLVED_RETRY_SECONDS = 3600;
class UnresolvedEventError extends Error {}

export async function applyWebhookEventInTx(client, event) {
  const type = String(event.event || "");
  const eventAt = epoch(event.created_at);
  const target = await resolveTarget(client, event);
  if (!target.organizationId) {
    const ageSeconds = event.created_at ? Date.now() / 1000 - Number(event.created_at) : Infinity;
    if (/^(payment|refund|invoice)./.test(type) && ageSeconds < UNRESOLVED_RETRY_SECONDS) {
      throw new UnresolvedEventError("provider object not known yet; retrying");
    }
    return { status: "ignored", organizationId: null, note: target.note };
  }
  const { organizationId, localSubscriptionId } = target;
  const payload = event.payload || {};
  let ledger = false;
  if (payload.payment?.entity) {
    await upsertPaymentInTx(client, { organizationId, subscriptionId: localSubscriptionId ?? null, payment: payload.payment.entity });
    ledger = true;
  }
  if (payload.invoice?.entity) {
    await upsertInvoiceInTx(client, { organizationId, subscriptionId: localSubscriptionId ?? null, invoice: payload.invoice.entity });
    ledger = true;
  }
  if (payload.refund?.entity && !payload.payment?.entity) ledger = (await recordRefundInTx(client, { organizationId, refund: payload.refund.entity })) || ledger;

  const entity = payload.subscription?.entity;
  if (!type.startsWith("subscription.") || !entity) return { status: ledger ? "processed" : "ignored", organizationId };

  if (target.current) {
    const result = await applySubscriptionEntityInTx(client, { organizationId, entity, eventAt, source: "webhook" });
    return { status: result.status === "processed" || ledger ? "processed" : "ignored", organizationId, note: result.reason };
  }
  const session = target.session;
  const providerStatus = String(entity.status || "").toLowerCase();
  if (session && ACTIVATING.includes(providerStatus)) {
    if (["superseded", "cancelled", "cancel_pending", "authorised"].includes(session.status)) {
      if (session.status !== "authorised") {
        await client.query(`UPDATE billing_checkout_sessions SET status='cancel_pending', next_recovery_at=now(), attention_required_at=COALESCE(attention_required_at, now()) WHERE id=$1`, [session.id]);
      }
      return { status: "processed", organizationId, note: "superseded checkout subscription queued for cancellation" };
    }
    const result = await applyCheckoutEntityInTx(client, session, entity, { source: "webhook", eventAt });
    return { status: "processed", organizationId, note: `checkout_${result.state}` };
  }
  if (session && TERMINAL_STATUSES.includes(mapProviderSubscriptionStatus(providerStatus)) && session.status !== "authorised") {
    await client.query(`UPDATE billing_checkout_sessions SET status='cancelled', next_recovery_at=NULL WHERE id=$1 AND status <> 'authorised'`, [session.id]);
    return { status: "processed", organizationId, note: "checkout subscription ended" };
  }
  return { status: ledger ? "processed" : "ignored", organizationId };
}
