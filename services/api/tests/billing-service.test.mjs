import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPlanEconomics,
  buildRazorpayPlanPayload,
  buildRazorpaySubscriptionPayload,
  hasWriteAccess,
  mapProviderSubscriptionStatus,
  shouldApplyProviderEvent,
} from "../src/billing.js";

test("billing economics keeps the Launch plan above the margin floor", () => {
  const result = assertPlanEconomics({
    amountPaise: 399900,
    estimatedDirectCostPaise: 80000,
    gatewayReservePercent: 4,
    minimumMarginPercent: 70,
  });
  assert.ok(result.grossMarginPercent >= 70);
});

test("Razorpay plan payload does not multiply by users", () => {
  const payload = buildRazorpayPlanPayload({
    id: "price",
    planCode: "launch",
    name: "Vercent ERP Launch",
    description: "Launch",
    billingPeriod: "monthly",
    amountPaise: 399900,
    currency: "INR",
    version: 1,
  });
  assert.equal(payload.item.amount, 399900);
  assert.equal(payload.interval, 1);
});

test("subscription payload uses quantity one and optional onboarding add-on", () => {
  const payload = buildRazorpaySubscriptionPayload({
    providerPlanId: "plan_123",
    billingPeriod: "monthly",
    onboardingFeePaise: 1999900,
    currency: "INR",
    organizationId: "org",
    planCode: "growth",
    planName: "Growth",
    planPriceId: "price",
    checkoutSessionId: "session",
  });
  assert.equal(payload.quantity, 1);
  assert.equal(payload.addons[0].item.amount, 1999900);
});

test("billing access and event ordering are deterministic", () => {
  assert.equal(hasWriteAccess({ status: "active" }), true);
  assert.equal(
    hasWriteAccess(
      { status: "expired", graceEndsAt: "2020-01-01T00:00:00Z" },
      new Date("2021-01-01T00:00:00Z"),
    ),
    false,
  );
  assert.equal(shouldApplyProviderEvent("2026-01-02", "2026-01-01"), false);
  assert.equal(mapProviderSubscriptionStatus("halted"), "halted");
});
