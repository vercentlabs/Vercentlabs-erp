// Internal helpers shared by the billing modules (not exported from the boundary).
import { audit } from "../security.js";

// Short local transaction on a dedicated client. Billing sagas commit BEFORE
// any provider HTTP call, so a transaction (and its row/advisory locks) is
// never held open while waiting on the network.
export async function tx(client, work) {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function billingAudit(client, { organizationId, actorUserId = null, eventType, entityId = null, metadata = {}, beforeData, afterData }) {
  await audit(client, {
    organizationId,
    actorUserId,
    eventType,
    entityType: "billing",
    entityId: entityId ? String(entityId) : null,
    metadata,
    beforeData,
    afterData,
  });
}

export const epoch = (seconds) => (seconds ? new Date(Number(seconds) * 1000) : null);
export const toEpochSeconds = (date) => Math.floor(new Date(date).getTime() / 1000);

export const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Bounded exponential backoff for recovery work, in seconds: 1m, 2m, 4m ... capped at 1h.
export function recoveryBackoffSeconds(attempts) {
  return Math.min(3600, 60 * 2 ** Math.max(0, Number(attempts) - 1));
}

export async function subscriptionRow(client, organizationId, { lock = false } = {}) {
  const res = await client.query(
    `SELECT s.*, price.amount_paise AS plan_amount_paise, price.version AS price_version, price.provider_plan_id AS price_provider_plan_id,
            price.active AS price_active, plan.code AS plan_code, plan.name AS plan_name, plan.pricing_model
       FROM organization_subscriptions s
       JOIN billing_plan_prices price ON price.id = s.plan_price_id
       JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE s.organization_id = $1${lock ? " FOR UPDATE OF s" : ""}`,
    [organizationId],
  );
  return res.rows[0] || null;
}
