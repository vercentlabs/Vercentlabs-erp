// One-off check against Razorpay TEST mode, for when real test keys exist. It creates a plan and a subscription
// with the exact payloads the app sends, reads it back, changes the quantity, and cancels it, then reports what
// Razorpay actually accepted. It touches no database. Refuses live keys.
//
//   RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... node scripts/qa/razorpay-smoke.mjs
import { buildRazorpayPlanPayload } from "../../services/api/src/core/billing.js";
import { createRazorpayProvider } from "../../services/api/src/core/razorpay.js";

const env = { ...process.env, RAZORPAY_MODE: "test" };
if (!env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") || !env.RAZORPAY_KEY_SECRET) {
  console.error("Set RAZORPAY_KEY_ID (rzp_test_...) and RAZORPAY_KEY_SECRET. Live keys are refused.");
  process.exit(2);
}
const provider = createRazorpayProvider(env);
const step = async (name, run) => {
  try {
    const result = await run();
    console.log(`OK    ${name}`, JSON.stringify(result).slice(0, 200));
    return result;
  } catch (error) {
    console.log(`FAIL  ${name}: ${error.message}`);
    return null;
  }
};

const plan = await step("create plan (Rs 1,000 per additional user, monthly)", () =>
  provider.createPlan(buildRazorpayPlanPayload({ id: "smoke", planCode: "standard", name: "Smoke - per additional user", description: "smoke", amountPaise: 100000, billingPeriod: "monthly", currency: "INR", version: 1 })),
);
const sub = plan && (await step("create subscription quantity 5", () => provider.createSubscription({ plan_id: plan.id, total_count: 12, quantity: 5, customer_notify: false, notes: { smoke: "1" } })));
if (sub) {
  await step("fetch subscription", () => provider.fetchSubscription(sub.id));
  await step("update quantity now (created state; Razorpay may refuse until authenticated)", () => provider.updateSubscription(sub.id, { quantity: 7, schedule_change_at: "now" }));
  await step("cancel", () => provider.cancelSubscription(sub.id, false));
}
console.log("\nThe seat-change and renewal steps only fully apply to an AUTHENTICATED subscription: open Checkout once in test mode with a test card, then rerun the update/cancel calls against that subscription.");
