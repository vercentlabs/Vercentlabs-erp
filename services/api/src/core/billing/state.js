// The one billing state model.
//
// organization_subscriptions.status is OUR state; provider_status is only the
// last status the provider reported. Checkout progress lives on the checkout
// session, a scheduled cancellation on cancel_at_cycle_end, and required
// operator attention on reconciliation_required_at, so the subscription
// status set stays small:
//
//   active         Free (plan free), Standard paid & charging, or a Custom contract
//   authenticated  Standard mandate authorised and confirmed with the provider; first charge pending
//   past_due       provider `pending`: a renewal charge failed, retries running (grace applies)
//   halted         provider `halted`: retries exhausted; business writes stop
//   internal       founder preview / internal organisations
//   cancelled | completed | expired   provider terminal states; applied by reverting to Free
//   trialing | checkout_pending       legacy values kept for historical rows
//
// Every change names its source; TRANSITIONS lists what each source may do.
import { BillingServiceError } from "./errors.js";

export const TRANSITION_SOURCES = Object.freeze(["checkout_confirmation", "provider_fetch", "webhook", "reconciliation", "administrator", "cancellation"]);

const PAID = ["authenticated", "active", "past_due", "halted"];
const TERMINAL = ["cancelled", "completed", "expired"];

export const TRANSITIONS = Object.freeze({
  active: ["active", "authenticated", "past_due", "halted", ...TERMINAL],
  authenticated: ["authenticated", "active", "past_due", "halted", ...TERMINAL],
  past_due: ["past_due", "active", "halted", ...TERMINAL],
  halted: ["halted", "active", ...TERMINAL],
  internal: ["internal", "active", "authenticated"],
  trialing: ["trialing", "active", "authenticated", ...TERMINAL],
  checkout_pending: ["checkout_pending", "active", "authenticated", ...TERMINAL],
  cancelled: ["active", "authenticated"],
  completed: ["active", "authenticated"],
  expired: ["active", "authenticated"],
});

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertTransition(from, to, source) {
  if (!TRANSITION_SOURCES.includes(source)) throw new BillingServiceError(500, `Unknown billing transition source ${source}.`, "BILLING_INVALID_TRANSITION");
  if (!canTransition(from, to)) {
    throw new BillingServiceError(409, `A ${from} subscription cannot become ${to} (${source}).`, "BILLING_INVALID_TRANSITION");
  }
}

// Provider subscription status -> our status. `created` has no entitlement
// meaning; `paused` is never used by Vercentlabs and needs operator attention.
export const PROVIDER_STATUS_MAP = Object.freeze({
  authenticated: "authenticated",
  active: "active",
  pending: "past_due",
  halted: "halted",
  cancelled: "cancelled",
  completed: "completed",
  expired: "expired",
});

export function mapProviderSubscriptionStatus(status) {
  return PROVIDER_STATUS_MAP[String(status || "").toLowerCase()] ?? null;
}

export const PAID_STATUSES = Object.freeze(PAID);
export const TERMINAL_STATUSES = Object.freeze(TERMINAL);

// The single answer to "may this organisation make ordinary business writes?"
// (seat overage is layered on top by getBillingSummary). Server time only.
export function hasWriteAccess(subscription, now = new Date()) {
  if (!subscription) return false;
  const at = (value) => (value ? new Date(value).getTime() : null);
  const nowMs = now.getTime();
  switch (subscription.status) {
    case "internal":
    case "authenticated":
      return true;
    case "active":
      // A Custom contract ends at its contracted date unless renewed.
      if (subscription.pricingModel === "custom" && subscription.contractEndsAt) return at(subscription.contractEndsAt) >= nowMs;
      return true;
    case "trialing":
      return Boolean(subscription.trialEndsAt) && at(subscription.trialEndsAt) >= nowMs;
    case "past_due":
      return Boolean(subscription.graceEndsAt) && at(subscription.graceEndsAt) >= nowMs;
    default:
      return false;
  }
}

// Out-of-order protection: never let an older provider event overwrite state
// derived from a newer one. The watermark (last_provider_event_at) only ever
// holds PROVIDER event timestamps; our own fetches never move it, so a fetch
// cannot make a genuinely newer event look stale.
export function shouldApplyProviderEvent(currentEventAt, incomingEventAt) {
  if (!incomingEventAt || !currentEventAt) return true;
  return new Date(incomingEventAt).getTime() >= new Date(currentEventAt).getTime();
}

// Tenant-facing state key. The UI maps keys to curated text; raw enums never reach users.
export function billingStateKey({ status, pricingModel, cancelAtCycleEnd, checkoutPhase, reconciliationRequired }) {
  if (checkoutPhase === "verifying") return "verification_pending";
  if (status === "internal") return "internal";
  if (pricingModel === "custom") return "custom_active";
  if (pricingModel === "free" || pricingModel === "flat") return status === "active" ? "free_active" : "inactive";
  if (reconciliationRequired && PAID.includes(status)) return "attention_required";
  if (cancelAtCycleEnd && ["active", "authenticated"].includes(status)) return "cancel_at_cycle_end";
  if (status === "authenticated") return "authenticated";
  if (status === "active") return "active";
  if (status === "past_due") return "past_due";
  if (status === "halted") return "halted";
  return "inactive";
}
