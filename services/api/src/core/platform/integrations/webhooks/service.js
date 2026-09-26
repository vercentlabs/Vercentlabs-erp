// Organisation webhooks for registered domain events.
//
// Signing contract (v1), documented in SHARED_PLATFORM_ARCHITECTURE.md:
//   X-Vercentlabs-Event:        the event type, e.g. crm.leads.assigned
//   X-Vercentlabs-Event-Id:     the stable event id
//   X-Vercentlabs-Delivery-Id:  the stable delivery id (same on every retry)
//   X-Vercentlabs-Timestamp:    unix seconds when this attempt was signed
//   X-Vercentlabs-Signature:    v1=<hex HMAC-SHA256(secret, "<delivery-id>.<timestamp>.<raw body>")>
// Receivers should reject a timestamp older than a few minutes and compare in
// constant time. Delivery is at-least-once: de-duplicate on the event id.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getDomainEvent, projectDomainEvent } from "../../events/index.js";
import { audit } from "../../../security.js";
import { decryptSecret, encryptSecret } from "../../secrets/index.js";
import { validateWebhookUrl } from "./ssrf.js";

export const WEBHOOK_MAX_ATTEMPTS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WebhookError extends Error {
  constructor(status, message, code = "PLATFORM_WEBHOOK_ERROR") {
    super(message);
    this.name = "WebhookError";
    this.status = status;
    this.code = code;
  }
}

// ------------------------------------------------------------ signing

export function createWebhookSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(secret, { deliveryId, timestamp, body }) {
  return createHmac("sha256", String(secret)).update(`${deliveryId}.${timestamp}.${body}`).digest("hex");
}

// For receivers and tests: true only for an exact v1 signature.
export function verifyOutboundWebhookSignature(secret, { deliveryId, timestamp, body, signatureHeader }) {
  const supplied = String(signatureHeader || "").replace(/^v1=/, "");
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const expected = Buffer.from(signWebhookPayload(secret, { deliveryId, timestamp, body }), "hex");
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ------------------------------------------------------------ administration

function allowPrivateTargets(env) {
  return env.NODE_ENV !== "production" && String(env.WEBHOOK_ALLOW_PRIVATE_TARGETS || "").toLowerCase() === "true";
}

function endpoint(value, env) {
  const url = String(value || "").trim();
  if (!url || url.length > 2000) throw new WebhookError(400, "Enter the endpoint URL.", "PLATFORM_WEBHOOK_ENDPOINT_INVALID");
  try {
    const parsed = validateWebhookUrl(url, { allowPrivate: allowPrivateTargets(env) });
    if (env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("HTTPS is required.");
    if (parsed.username || parsed.password) throw new Error("Credentials in the URL are not allowed.");
    return parsed.toString();
  } catch (error) {
    throw new WebhookError(400, `This endpoint cannot receive webhooks: ${error instanceof Error ? error.message : "invalid URL"}`, "PLATFORM_WEBHOOK_ENDPOINT_INVALID");
  }
}

function eventTypes(value) {
  if (!Array.isArray(value) || value.length === 0) throw new WebhookError(400, "Choose at least one event.", "PLATFORM_WEBHOOK_EVENTS_REQUIRED");
  const unique = [...new Set(value.map(String))];
  for (const type of unique) if (!getDomainEvent(type)) throw new WebhookError(400, `"${type.slice(0, 80)}" is not an available event.`, "PLATFORM_WEBHOOK_EVENT_UNKNOWN");
  return unique.sort();
}

function subscriptionDto(row) {
  const events = (row.event_types || []).map(String);
  return {
    id: row.id,
    name: row.name,
    endpointUrl: row.endpoint_url,
    eventTypes: events.filter((type) => getDomainEvent(type)),
    unrecognizedEventTypes: events.filter((type) => !getDomainEvent(type)),
    status: row.status,
    signed: Boolean(row.encrypted_signing_secret),
    secretVersion: row.secret_version,
    secretRotatedAt: row.secret_rotated_at,
    createdAt: row.created_at,
    lastDeliveryAt: row.last_delivery_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    consecutiveFailures: row.consecutive_failures,
    health: row.status !== "active" ? "disabled" : row.consecutive_failures >= 5 ? "failing" : row.consecutive_failures > 0 ? "degraded" : row.last_success_at ? "healthy" : "no_deliveries",
    pendingDeliveries: Number(row.pending_deliveries ?? 0),
    deadDeliveries: Number(row.dead_deliveries ?? 0),
  };
}

export async function listWebhookSubscriptions(client, organizationId) {
  const { rows } = await client.query(
    `SELECT subscription.*,
            (SELECT count(*) FROM tenant.webhook_deliveries delivery WHERE delivery.subscription_id = subscription.id AND delivery.status IN ('pending','retry','processing'))::int AS pending_deliveries,
            (SELECT count(*) FROM tenant.webhook_deliveries delivery WHERE delivery.subscription_id = subscription.id AND delivery.status = 'dead')::int AS dead_deliveries
       FROM tenant.webhook_subscriptions subscription
      WHERE subscription.organization_id=$1
      ORDER BY (subscription.status='active') DESC, subscription.created_at DESC`,
    [organizationId],
  );
  return rows.map(subscriptionDto);
}

async function loadSubscription(client, organizationId, id) {
  if (!UUID.test(String(id || ""))) throw new WebhookError(404, "Webhook not found.", "PLATFORM_WEBHOOK_NOT_FOUND");
  const { rows } = await client.query(`SELECT * FROM tenant.webhook_subscriptions WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [organizationId, id]);
  if (!rows[0]) throw new WebhookError(404, "Webhook not found.", "PLATFORM_WEBHOOK_NOT_FOUND");
  return rows[0];
}

// The signing secret is returned ONCE here; only its encrypted form is kept.
export async function createWebhookSubscription(client, session, input, env = process.env) {
  const name = String(input?.name || "").trim().slice(0, 120);
  if (!name) throw new WebhookError(400, "Name the webhook.", "PLATFORM_WEBHOOK_NAME_REQUIRED");
  const url = endpoint(input?.endpointUrl, env);
  const types = eventTypes(input?.eventTypes);
  const secret = createWebhookSecret();
  const { rows } = await client.query(
    `INSERT INTO tenant.webhook_subscriptions (organization_id, name, endpoint_url, event_types, encrypted_signing_secret, secret_rotated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4::text[],$5::jsonb,now(),$6,$6) RETURNING *`,
    [session.organizationId, name, url, types, JSON.stringify(await encryptSecret({ secret }, env)), session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.webhook_created", entityType: "webhook_subscription", entityId: rows[0].id, afterData: { name, endpointUrl: url, eventTypes: types } });
  return { subscription: subscriptionDto(rows[0]), signingSecret: secret };
}

export async function updateWebhookSubscription(client, session, id, input, env = process.env) {
  const current = await loadSubscription(client, session.organizationId, id);
  const name = input?.name !== undefined ? String(input.name).trim().slice(0, 120) : current.name;
  if (!name) throw new WebhookError(400, "Name the webhook.", "PLATFORM_WEBHOOK_NAME_REQUIRED");
  const url = input?.endpointUrl !== undefined ? endpoint(input.endpointUrl, env) : current.endpoint_url;
  const types = input?.eventTypes !== undefined ? eventTypes(input.eventTypes) : current.event_types;
  const status = input?.status !== undefined ? (input.status === "active" ? "active" : input.status === "disabled" ? "disabled" : null) : current.status;
  if (!status) throw new WebhookError(400, "Unsupported status.", "PLATFORM_WEBHOOK_STATUS_INVALID");
  const { rows } = await client.query(
    `UPDATE tenant.webhook_subscriptions SET name=$2, endpoint_url=$3, event_types=$4::text[], status=$5,
            consecutive_failures=CASE WHEN $5='active' AND status<>'active' THEN 0 ELSE consecutive_failures END, updated_by=$6, updated_at=now()
      WHERE id=$1 RETURNING *`,
    [current.id, name, url, types, status, session.userId],
  );
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "integration.webhook_updated",
    entityType: "webhook_subscription",
    entityId: current.id,
    beforeData: { name: current.name, endpointUrl: current.endpoint_url, eventTypes: current.event_types, status: current.status },
    afterData: { name, endpointUrl: url, eventTypes: types, status },
  });
  return subscriptionDto(rows[0]);
}

// New secret, returned ONCE. Deliveries signed from now on use it.
export async function rotateWebhookSecret(client, session, id, env = process.env) {
  const current = await loadSubscription(client, session.organizationId, id);
  const secret = createWebhookSecret();
  const { rows } = await client.query(
    `UPDATE tenant.webhook_subscriptions SET encrypted_signing_secret=$2::jsonb, secret_version=secret_version+1, secret_rotated_at=now(), updated_by=$3, updated_at=now()
      WHERE id=$1 RETURNING *`,
    [current.id, JSON.stringify(await encryptSecret({ secret }, env)), session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.webhook_secret_rotated", entityType: "webhook_subscription", entityId: current.id, metadata: { secretVersion: rows[0].secret_version } });
  return { subscription: subscriptionDto(rows[0]), signingSecret: secret };
}

export async function listWebhookDeliveries(client, organizationId, { subscriptionId = null, status = null, limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT delivery.id, delivery.subscription_id, delivery.event_id, delivery.event_type, delivery.status, delivery.attempt_count, delivery.next_attempt_at,
            delivery.last_error, delivery.last_status_code, delivery.delivered_at, delivery.redelivery_count, delivery.created_at, delivery.updated_at
       FROM tenant.webhook_deliveries delivery
      WHERE delivery.organization_id=$1 AND ($2::uuid IS NULL OR delivery.subscription_id=$2::uuid) AND ($3::text IS NULL OR delivery.status=$3::text)
      ORDER BY delivery.created_at DESC LIMIT $4`,
    [organizationId, subscriptionId && UUID.test(subscriptionId) ? subscriptionId : null, status, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map((row) => ({
    id: row.id,
    subscriptionId: row.subscription_id,
    eventId: row.event_id,
    eventType: row.event_type,
    eventLabel: getDomainEvent(row.event_type)?.label ?? "Event",
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ? String(row.last_error).slice(0, 300) : null,
    lastStatusCode: row.last_status_code,
    deliveredAt: row.delivered_at,
    redeliveryCount: row.redelivery_count,
    createdAt: row.created_at,
  }));
}

// Manual retry of ONE failed/dead delivery: same delivery id and event id,
// so the receiver can de-duplicate; recorded as a redelivery.
export async function redeliverWebhookDelivery(client, session, deliveryId) {
  if (!UUID.test(String(deliveryId || ""))) throw new WebhookError(404, "Delivery not found.", "PLATFORM_WEBHOOK_DELIVERY_NOT_FOUND");
  const { rows } = await client.query(
    `UPDATE tenant.webhook_deliveries SET status='pending', next_attempt_at=now(), redelivery_count=redelivery_count+1, attempt_count=0, updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND status IN ('retry','dead') RETURNING id, subscription_id, event_id`,
    [session.organizationId, deliveryId],
  );
  if (!rows[0]) throw new WebhookError(409, "Only a failed delivery can be sent again.", "PLATFORM_WEBHOOK_REDELIVERY_NOT_ALLOWED");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.webhook_redelivered", entityType: "webhook_delivery", entityId: rows[0].id, metadata: { subscriptionId: rows[0].subscription_id, eventId: rows[0].event_id } });
  return { id: rows[0].id, status: "pending" };
}

// ------------------------------------------------------------ fan-out (worker)

// One delivery row per matching active subscription that existed when the
// event occurred (a new webhook never receives older events); idempotent on
// (event_id, subscription_id). Unregistered events never leave the system.
export async function fanOutWebhookDeliveries(client, event) {
  if (!getDomainEvent(event.event_type)) return;
  await client.query(
    `INSERT INTO tenant.webhook_deliveries (organization_id, event_id, subscription_id, event_type)
     SELECT $1, $2, subscription.id, $3 FROM tenant.webhook_subscriptions subscription
      WHERE subscription.organization_id=$1 AND subscription.status='active' AND $3 = ANY(subscription.event_types)
        AND subscription.created_at <= $4::timestamptz
     ON CONFLICT (event_id, subscription_id) DO NOTHING`,
    [event.organization_id, event.id, event.event_type, event.occurred_at ?? event.created_at ?? new Date()],
  );
}

// Leases due deliveries (FOR UPDATE SKIP LOCKED); an expired lease from a
// crashed worker is reclaimable.
export async function claimWebhookDeliveries(client, organizationId, { workerId, leaseMilliseconds, batchSize = 10 }) {
  if (!workerId) throw new Error("workerId is required to claim webhook deliveries.");
  const { rows } = await client.query(
    `WITH due AS (
       SELECT delivery.id FROM tenant.webhook_deliveries delivery
         JOIN tenant.webhook_subscriptions subscription ON subscription.id = delivery.subscription_id AND subscription.status = 'active'
        WHERE delivery.organization_id=$1
          AND ((delivery.status IN ('pending','retry') AND delivery.next_attempt_at <= now())
               OR (delivery.status = 'processing' AND delivery.locked_at < now() - ($3 || ' milliseconds')::interval))
        ORDER BY delivery.next_attempt_at, delivery.id
        LIMIT $4 FOR UPDATE OF delivery SKIP LOCKED
     )
     UPDATE tenant.webhook_deliveries delivery
        SET status='processing', locked_by=$2, locked_at=now(), attempt_count=attempt_count+1, updated_at=now()
       FROM due WHERE delivery.id = due.id
     RETURNING delivery.*`,
    [organizationId, workerId, String(leaseMilliseconds), batchSize],
  );
  if (!rows.length) return [];
  const details = await client.query(
    `SELECT delivery.id AS delivery_id, subscription.endpoint_url, subscription.encrypted_signing_secret, event.*
       FROM tenant.webhook_deliveries delivery
       JOIN tenant.webhook_subscriptions subscription ON subscription.id = delivery.subscription_id
       JOIN tenant.platform_events event ON event.id = delivery.event_id
      WHERE delivery.id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)],
  );
  const byId = new Map(details.rows.map((row) => [row.delivery_id, row]));
  return rows.map((row) => ({ ...row, detail: byId.get(row.id) }));
}

/** The exact request for one claimed delivery (no I/O besides decryption). */
export async function buildWebhookRequest(claimed, { env = process.env, now = new Date() } = {}) {
  const envelope = projectDomainEvent(claimed.detail);
  if (!envelope) throw new WebhookError(500, "The event type is no longer registered.", "PLATFORM_WEBHOOK_EVENT_UNKNOWN");
  const body = JSON.stringify(envelope);
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const headers = {
    "x-vercentlabs-event": envelope.type,
    "x-vercentlabs-event-id": envelope.id,
    "x-vercentlabs-delivery-id": claimed.id,
    "x-vercentlabs-timestamp": timestamp,
  };
  if (claimed.detail.encrypted_signing_secret) {
    const { secret } = await decryptSecret(claimed.detail.encrypted_signing_secret, env);
    headers["x-vercentlabs-signature"] = `v1=${signWebhookPayload(secret, { deliveryId: claimed.id, timestamp, body })}`;
  }
  return { url: claimed.detail.endpoint_url, body, headers, deliveryId: claimed.id };
}

export async function completeWebhookDelivery(client, deliveryId, workerId, { statusCode = null, responseSummary = null } = {}) {
  const { rows } = await client.query(
    `UPDATE tenant.webhook_deliveries SET status='delivered', delivered_at=now(), last_status_code=$3, response_summary=$4, last_error=NULL, locked_by=NULL, locked_at=NULL, updated_at=now()
      WHERE id=$1 AND locked_by=$2 RETURNING subscription_id`,
    [deliveryId, workerId, statusCode, responseSummary ? String(responseSummary).slice(0, 500) : null],
  );
  if (rows[0]) {
    await client.query(`UPDATE tenant.webhook_subscriptions SET last_delivery_at=now(), last_success_at=now(), consecutive_failures=0 WHERE id=$1`, [rows[0].subscription_id]);
  }
  return Boolean(rows[0]);
}

// Retryable failures back off; after the attempt budget (or a terminal
// failure) the delivery is dead and stays inspectable.
export async function failWebhookDelivery(client, deliveryId, workerId, { error, statusCode = null, retryable = true, backoffMilliseconds, maxAttempts = WEBHOOK_MAX_ATTEMPTS }) {
  const { rows } = await client.query(
    `UPDATE tenant.webhook_deliveries
        SET status=CASE WHEN NOT $5 OR attempt_count >= $6 THEN 'dead' ELSE 'retry' END,
            next_attempt_at=now() + ($4 || ' milliseconds')::interval,
            last_error=$3, last_status_code=$7, locked_by=NULL, locked_at=NULL, updated_at=now()
      WHERE id=$1 AND locked_by=$2 RETURNING subscription_id, status`,
    [deliveryId, workerId, String(error || "").slice(0, 2000), String(backoffMilliseconds ?? 60_000), Boolean(retryable), maxAttempts, statusCode],
  );
  if (rows[0]) {
    await client.query(`UPDATE tenant.webhook_subscriptions SET last_delivery_at=now(), last_failure_at=now(), consecutive_failures=consecutive_failures+1 WHERE id=$1`, [rows[0].subscription_id]);
  }
  return rows[0]?.status ?? null;
}
