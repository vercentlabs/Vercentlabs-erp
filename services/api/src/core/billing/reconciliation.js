// The one provider <-> local reconciliation service. Used by the manual
// "Refresh status" action and by the worker's scheduled pass.
import { verifyCheckoutWithProvider } from "./checkout.js";
import { BillingServiceError } from "./errors.js";
import { billingEvent } from "./observability.js";
import { applySubscriptionEntityInTx } from "./subscriptions.js";
import { billingAudit, subscriptionRow, tx } from "./shared.js";

export function providerSubscriptionMismatches(sub, remote) {
  const problems = [];
  if (remote?.id !== sub.provider_subscription_id) problems.push("subscription_id");
  const orgNote = remote?.notes?.vercentlabs_organization_id;
  if (orgNote && orgNote !== sub.organization_id) problems.push("organization_note");
  if (sub.price_provider_plan_id && remote?.plan_id && remote.plan_id !== sub.price_provider_plan_id) problems.push("plan_id");
  return problems;
}

export async function reconcileSubscription(client, organizationId, provider, { actorUserId = null } = {}) {
  const sub = await subscriptionRow(client, organizationId);
  if (!sub?.provider_subscription_id) return { reconciled: false, reason: "no_provider_subscription" };
  let remote;
  try {
    remote = await provider.fetchSubscription(sub.provider_subscription_id);
  } catch {
    return { reconciled: false, reason: "provider_unavailable" };
  }
  const problems = providerSubscriptionMismatches(sub, remote);
  if (problems.length) {
    await tx(client, async () => {
      await client.query(
        `UPDATE organization_subscriptions SET reconciliation_required_at = COALESCE(reconciliation_required_at, now()), reconciliation_note=$2 WHERE organization_id=$1 AND provider_subscription_id=$3`,
        [organizationId, `Provider subscription does not match local records (${problems.join(", ")}).`, sub.provider_subscription_id],
      );
      await billingAudit(client, { organizationId, actorUserId, eventType: "billing.reconciliation.intervention_required", entityId: sub.id, metadata: { problems } });
    });
    billingEvent("billing.reconciliation.mismatch", { organizationId, problems }, { kind: "identity" });
    return { reconciled: false, reason: "mismatch", problems };
  }
  const result = await tx(client, async () => {
    const applied = await applySubscriptionEntityInTx(client, { organizationId, entity: remote, eventAt: null, source: "reconciliation" });
    if (applied.status === "processed" && applied.outcome !== "attention") {
      await client.query(
        `UPDATE organization_subscriptions SET last_provider_sync_at=now(), reconciliation_required_at=NULL, reconciliation_note=NULL WHERE organization_id=$1 AND provider_subscription_id=$2`,
        [organizationId, remote.id],
      );
    }
    return applied;
  });
  if (result.status === "processed" && sub.status !== result.outcome && result.outcome !== "attention") {
    billingEvent("billing.reconciliation.mismatch", { organizationId, localStatus: sub.status, providerStatus: remote.status, applied: result.outcome }, { kind: "state" });
  }
  billingEvent("billing.reconciliation.success", { organizationId, providerStatus: remote.status, outcome: result.outcome ?? result.reason }, {});
  return { reconciled: result.status === "processed", providerStatus: remote.status, outcome: result.outcome ?? result.reason };
}

// "Refresh status": finishes a checkout that is waiting for verification, then
// reconciles the current subscription.
export async function syncSubscriptionFromProvider(client, ctx, provider) {
  const verifying = (await client.query(`SELECT id FROM billing_checkout_sessions WHERE organization_id=$1 AND status='verifying'`, [ctx.organizationId])).rows[0];
  let checkout = null;
  if (verifying) checkout = await verifyCheckoutWithProvider(client, verifying.id, provider, { actorUserId: ctx.userId });
  const result = await reconcileSubscription(client, ctx.organizationId, provider, { actorUserId: ctx.userId });
  if (!checkout && result.reason === "no_provider_subscription") return { synced: false, reason: result.reason };
  if (result.reason === "provider_unavailable" && !checkout) {
    throw new BillingServiceError(502, "The payment provider could not be reached. Billing will update automatically.", "BILLING_PROVIDER_UNREACHABLE");
  }
  return { synced: true, checkout: checkout?.state ?? null, providerStatus: result.providerStatus ?? null, reason: result.reason ?? null };
}
