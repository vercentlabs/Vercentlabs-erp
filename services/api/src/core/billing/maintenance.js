// Platform billing maintenance, run by the worker. Billing tables are platform
// data (a webhook may not yet belong to any organisation), so this never sets
// tenant RLS context and never goes through tenant.background_jobs.
//
// Every item is claimed before work: webhooks by lease (processing_owner +
// processing_lease_expires_at), recovery rows by pushing their due time forward
// under FOR UPDATE SKIP LOCKED, so parallel workers never pick the same row.
// Provider HTTP always happens outside any transaction.
import { recoverCheckoutSession } from "./checkout.js";
import { billingLogger } from "./observability.js";
import { reconcileSubscription } from "./reconciliation.js";
import { recoverSeatChange } from "./seats.js";
import { recoverCancellation } from "./subscriptions.js";
import { claimWebhookEvents, processClaimedWebhookEvent } from "./webhooks.js";
import { subscriptionRow } from "./shared.js";

const RECONCILE_EVERY_HOURS = 24;

async function claimDueCheckouts(client, { limit, leaseSeconds }) {
  return (
    await client.query(
      `UPDATE billing_checkout_sessions SET next_recovery_at = now() + make_interval(secs => $2)
        WHERE id IN (
          SELECT id FROM billing_checkout_sessions
           WHERE (status IN ('provider_link_pending','provider_recovery_pending','verifying','cancel_pending','created') AND next_recovery_at <= now())
              OR (status = 'provider_creating' AND COALESCE(next_recovery_at, updated_at + interval '2 minutes') <= now())
           ORDER BY next_recovery_at NULLS FIRST LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id`,
      [limit, leaseSeconds],
    )
  ).rows.map((row) => row.id);
}

async function claimDueSeatChanges(client, { limit, leaseSeconds }) {
  return (
    await client.query(
      `UPDATE billing_seat_changes SET next_attempt_at = now() + make_interval(secs => $2)
        WHERE id IN (SELECT id FROM billing_seat_changes WHERE status='provider_pending' AND COALESCE(next_attempt_at, created_at) <= now()
                      ORDER BY next_attempt_at NULLS FIRST LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [limit, leaseSeconds],
    )
  ).rows;
}

async function claimDueCancellations(client, { limit, leaseSeconds }) {
  return (
    await client.query(
      `UPDATE organization_subscriptions SET cancel_next_attempt_at = now() + make_interval(secs => $2)
        WHERE id IN (SELECT id FROM organization_subscriptions WHERE cancellation_state='provider_pending' AND COALESCE(cancel_next_attempt_at, cancel_requested_at) <= now()
                      LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING organization_id`,
      [limit, leaseSeconds],
    )
  ).rows.map((row) => row.organization_id);
}

// Due for reconciliation: never synced, synced over a day ago, flagged, or a
// period/cancellation that should have ended. Claiming pushes the next check ~1h out.
async function claimDueReconciliations(client, { limit }) {
  return (
    await client.query(
      `UPDATE organization_subscriptions SET last_provider_sync_at = now() - make_interval(hours => $2 - 1)
        WHERE id IN (
          SELECT id FROM organization_subscriptions
           WHERE provider_subscription_id IS NOT NULL
             AND (last_provider_sync_at IS NULL OR last_provider_sync_at < now() - make_interval(hours => $2)
                  OR (reconciliation_required_at IS NOT NULL AND last_provider_sync_at < now() - interval '1 hour')
                  OR (current_period_ends_at < now() - interval '1 hour' AND last_provider_sync_at < current_period_ends_at))
           LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING organization_id`,
      [limit, RECONCILE_EVERY_HOURS],
    )
  ).rows.map((row) => row.organization_id);
}

// One maintenance pass. `connect` returns a platform client with release().
export async function runBillingMaintenance({ connect, provider, workerId, batchSize = 20, leaseSeconds = 120, steps = null }) {
  const summary = { webhooks: {}, checkouts: 0, seatChanges: 0, cancellations: 0, reconciliations: 0 };
  const enabled = (step) => !steps || steps.includes(step);
  const client = await connect();
  try {
    if (enabled("webhooks")) {
      const rows = await claimWebhookEvents(client, { workerId, limit: batchSize, leaseSeconds });
      for (const row of rows) {
        const status = await processClaimedWebhookEvent(client, row, workerId);
        summary.webhooks[status] = (summary.webhooks[status] || 0) + 1;
      }
    }
    if (enabled("checkouts")) {
      for (const id of await claimDueCheckouts(client, { limit: batchSize, leaseSeconds })) {
        await recoverCheckoutSession(client, id, provider);
        summary.checkouts += 1;
      }
    }
    if (enabled("seats")) {
      for (const change of await claimDueSeatChanges(client, { limit: batchSize, leaseSeconds })) {
        await recoverSeatChange(client, change, provider);
        summary.seatChanges += 1;
      }
    }
    if (enabled("cancellations")) {
      for (const organizationId of await claimDueCancellations(client, { limit: batchSize, leaseSeconds })) {
        const sub = await subscriptionRow(client, organizationId);
        if (sub?.cancellation_state === "provider_pending" && sub.provider_subscription_id) await recoverCancellation(client, sub, provider);
        summary.cancellations += 1;
      }
    }
    if (enabled("reconciliation")) {
      for (const organizationId of await claimDueReconciliations(client, { limit: batchSize })) {
        await reconcileSubscription(client, organizationId, provider);
        summary.reconciliations += 1;
      }
    }
  } finally {
    client.release?.();
  }
  const didWork = Object.keys(summary.webhooks).length || summary.checkouts || summary.seatChanges || summary.cancellations || summary.reconciliations;
  if (didWork) billingLogger.info("billing maintenance pass", { workerId, ...summary });
  return summary;
}
