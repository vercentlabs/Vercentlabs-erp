export class BillingDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BillingDomainError";
    this.code = code;
  }
}

export const PROVIDER_STATUS_MAP = Object.freeze({
  created: "checkout_pending",
  authenticated: "authenticated",
  active: "active",
  pending: "past_due",
  halted: "halted",
  cancelled: "cancelled",
  completed: "completed",
  expired: "expired",
});

export function mapProviderSubscriptionStatus(status) {
  return (
    PROVIDER_STATUS_MAP[String(status || "").toLowerCase()] ||
    "checkout_pending"
  );
}

export function buildRazorpayPlanPayload(price) {
  if (
    !price?.name ||
    !Number.isInteger(price.amountPaise) ||
    price.amountPaise <= 0
  ) {
    throw new BillingDomainError(
      "invalid_plan",
      "A positive recurring price is required.",
    );
  }
  if (!["monthly", "yearly"].includes(price.billingPeriod)) {
    throw new BillingDomainError(
      "invalid_period",
      "Razorpay plans must be monthly or yearly.",
    );
  }
  return {
    period: price.billingPeriod,
    interval: 1,
    item: {
      name: price.name,
      description: price.description || price.name,
      amount: price.amountPaise,
      currency: price.currency || "INR",
    },
    notes: {
      vercent_plan_code: price.planCode,
      vercent_price_id: price.id,
      vercent_price_version: String(price.version || 1),
    },
  };
}

export function buildRazorpaySubscriptionPayload(input) {
  if (!input?.providerPlanId) {
    throw new BillingDomainError(
      "plan_not_synced",
      "The selected price is not synced with Razorpay.",
    );
  }
  const totalCount = input.billingPeriod === "yearly" ? 10 : 120;
  const payload = {
    plan_id: input.providerPlanId,
    total_count: totalCount,
    quantity: 1,
    customer_notify: true,
    notes: {
      vercent_organization_id: input.organizationId,
      vercent_plan_code: input.planCode,
      vercent_plan_price_id: input.planPriceId,
      vercent_checkout_session_id: input.checkoutSessionId,
    },
  };
  if (Number(input.onboardingFeePaise) > 0) {
    payload.addons = [
      {
        item: {
          name: `${input.planName} onboarding`,
          amount: Number(input.onboardingFeePaise),
          currency: input.currency || "INR",
        },
      },
    ];
  }
  return payload;
}

export function calculatePlanEconomics({
  amountPaise,
  estimatedDirectCostPaise,
  gatewayReservePercent = 4,
}) {
  const gatewayReservePaise = Math.ceil(
    amountPaise * (gatewayReservePercent / 100),
  );
  const contributionPaise =
    amountPaise - gatewayReservePaise - estimatedDirectCostPaise;
  const grossMarginPercent =
    amountPaise > 0 ? (contributionPaise / amountPaise) * 100 : 0;
  return { gatewayReservePaise, contributionPaise, grossMarginPercent };
}

export function assertPlanEconomics(input) {
  const result = calculatePlanEconomics(input);
  const floor = Number(input.minimumMarginPercent ?? 70);
  if (result.grossMarginPercent < floor) {
    throw new BillingDomainError(
      "margin_floor",
      `Plan gross margin ${result.grossMarginPercent.toFixed(1)}% is below the ${floor}% floor.`,
    );
  }
  return result;
}

export function hasWriteAccess(subscription, now = new Date()) {
  if (!subscription) return false;
  if (["active", "authenticated", "internal"].includes(subscription.status))
    return true;
  if (subscription.status === "trialing" && subscription.trialEndsAt) {
    return new Date(subscription.trialEndsAt).getTime() >= now.getTime();
  }
  if (
    ["past_due", "halted"].includes(subscription.status) &&
    subscription.graceEndsAt
  ) {
    return new Date(subscription.graceEndsAt).getTime() >= now.getTime();
  }
  return false;
}

export function shouldApplyProviderEvent(currentEventAt, incomingEventAt) {
  if (!incomingEventAt) return true;
  if (!currentEventAt) return true;
  return (
    new Date(incomingEventAt).getTime() >= new Date(currentEventAt).getTime()
  );
}
