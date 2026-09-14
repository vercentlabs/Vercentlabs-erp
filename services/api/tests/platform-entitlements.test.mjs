import assert from "node:assert/strict";
import test from "node:test";

import { billingEnforcementMode, getBillingSummary, EntitlementError, incrementBillingUsage } from "../src/core/entitlements.js";

test("billingEnforcementMode defaults to enforce in production and observe elsewhere unless explicitly configured", () => {
  assert.equal(billingEnforcementMode({ NODE_ENV: "production" }), "enforce");
  assert.equal(billingEnforcementMode({ NODE_ENV: "test" }), "observe");
  assert.equal(billingEnforcementMode({ NODE_ENV: "production", BILLING_ENFORCEMENT_MODE: "observe" }), "observe");
});

test("getBillingSummary throws EntitlementError(409) when billing was never initialised for the organisation", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    getBillingSummary(client, "org-without-billing", {}),
    (error) => error instanceof EntitlementError && error.status === 409,
  );
});

test("incrementBillingUsage rejects a replayed idempotency key that carries a different quantity (divergence detection)", async () => {
  const client = {
    query: async (sql) => {
      if (/organization_subscriptions/.test(sql)) {
        return {
          rows: [
            {
              status: "active",
              plan_code: "growth",
              plan_name: "Growth",
              billing_period: "monthly",
              current_period_ends_at: null,
              trial_ends_at: null,
              grace_ends_at: null,
              cancel_at_cycle_end: false,
              provider_subscription_id: null,
              modules_snapshot: ["crm"],
              limits_snapshot: {},
            },
          ],
        };
      }
      if (/billing_usage_monthly/.test(sql) && /SELECT/.test(sql)) return { rows: [] };
      if (/billing_entitlement_overrides/.test(sql)) return { rows: [] };
      if (/INSERT INTO billing_usage_events/.test(sql)) return { rows: [] }; // conflict -> no row returned
      if (/SELECT quantity,source FROM billing_usage_events/.test(sql)) {
        return { rows: [{ quantity: 999, source: "runtime" }] }; // different quantity than requested (1)
      }
      return { rows: [] };
    },
  };
  await assert.rejects(
    incrementBillingUsage(client, "org-1", "api_requests_monthly", 1, { idempotencyKey: "key-1", env: { NODE_ENV: "test" } }),
    (error) => error instanceof EntitlementError && error.code === "BILLING_IDEMPOTENCY_CONFLICT",
  );
});

test("incrementBillingUsage rejects a non-positive quantity", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    incrementBillingUsage(client, "org-1", "api_requests_monthly", 0),
    (error) => error instanceof EntitlementError && error.status === 400,
  );
});
