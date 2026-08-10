import { deliverWebhook, WebhookDeliveryError } from "../webhook-delivery.js";

// Delivers one tenant.crm_outbox_events row to every currently-active
// tenant.crm_webhook_subscriptions row whose event_types array includes
// this event's event_type.
//
// KNOWN LIMITATION, deliberately not solved by new schema (Part 35 — "do
// not create huge logging schema unless necessary"): crm_outbox_events
// has exactly one status/attempt_count/last_error per EVENT, not per
// (event, subscription) pair, because that is the schema this prompt
// found and reused rather than redesigned. With zero matching
// subscriptions the event is marked delivered immediately (nothing to
// deliver to is not an error). With exactly one matching subscription —
// the common case — the event's status reflects that subscription's real
// outcome 1:1. With MORE than one matching subscription, this is
// at-least-once, not effectively-once, for the fan-out case: a retry
// re-delivers to every matching subscription, including ones that already
// succeeded on an earlier attempt, because there is nowhere in this
// schema to record "subscription B already got a copy." See
// ERP_WORKER_SCHEDULER_013.md Section 17 for the full, honest writeup —
// this is documented, not silently accepted.
// Reads the matching subscriptions only — no external I/O. Called inside
// a short, read-only tenant-scoped transaction (Part 44: never hold a
// transaction open across an external HTTP call).
export async function findMatchingSubscriptions(client, organizationId, eventType) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_webhook_subscriptions
      WHERE organization_id = $1 AND status = 'active' AND $2 = ANY(event_types)`,
    [organizationId, eventType],
  );
  return rows;
}

// Performs the actual HTTP deliveries. Deliberately takes no `client` —
// this function must never be called from inside an open DB transaction.
export async function deliverOutboxEvent(subscriptions, event, config) {
  if (subscriptions.length === 0) {
    return { outcome: "success", matchedSubscriptions: 0, deliveries: [] };
  }

  const deliveries = [];
  for (const subscription of subscriptions) {
    try {
      const delivery = await deliverWebhook(subscription.endpoint_url, {
        payload: {
          id: event.id,
          eventType: event.event_type,
          entityType: event.entity_type,
          entityId: event.entity_id,
          payload: event.payload,
          occurredAt: event.created_at,
        },
        timeoutMilliseconds: config.webhookTimeoutMilliseconds,
        allowPrivateTargets: config.allowPrivateWebhookTargets,
        deliveryId: event.id,
      });
      deliveries.push({ subscriptionId: subscription.id, ...delivery, retryable: delivery.outcome === "retryable" });
    } catch (error) {
      const retryable = error instanceof WebhookDeliveryError ? error.retryable : true;
      deliveries.push({
        subscriptionId: subscription.id,
        outcome: "error",
        retryable,
        message: String(error?.message || error).slice(0, 1_000),
        code: error?.code || "WEBHOOK_DELIVERY_ERROR",
      });
    }
  }

  const failures = deliveries.filter((delivery) => delivery.outcome !== "success");
  if (failures.length === 0) {
    return { outcome: "success", matchedSubscriptions: subscriptions.length, deliveries };
  }
  const anyRetryable = failures.some((failure) => failure.retryable !== false);
  return {
    outcome: anyRetryable ? "retryable" : "terminal",
    matchedSubscriptions: subscriptions.length,
    deliveries,
    summary: failures.map((failure) => `${failure.subscriptionId}: ${failure.message || failure.statusCode}`).join("; ").slice(0, 3_000),
  };
}
