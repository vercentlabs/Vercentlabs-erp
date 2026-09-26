// Optional check against Razorpay TEST mode. Runs only when test keys are
// explicitly provided; CI never needs it and it refuses live keys. It creates a
// plan and a subscription with the exact payloads the app sends, reads it back,
// lists it by plan (the recovery path), and reports what Razorpay accepted.
// It touches no database and never prints secrets.
//
//   RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... node scripts/qa/razorpay-smoke.mjs
import { buildProviderPlanPayload, createRazorpayProvider } from "../../services/api/src/core/billing/index.js";

const env = { ...process.env, RAZORPAY_MODE: "test", RAZORPAY_API_BASE: "" };
if (!env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") || !env.RAZORPAY_KEY_SECRET) {
  console.log("SKIP  Razorpay smoke: set RAZORPAY_KEY_ID (rzp_test_...) and RAZORPAY_KEY_SECRET to run it. Live keys are refused.");
  process.exit(0);
}
const provider = createRazorpayProvider(env);
const summarize = (value) => JSON.stringify({ id: value?.id, status: value?.status, quantity: value?.quantity, plan_id: value?.plan_id, count: value?.count });
let failures = 0;
const step = async (name, run) => {
  try {
    const result = await run();
    console.log(`OK    ${name} ${summarize(result)}`);
    return result;
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}: ${error.code} (${error.outcome ?? "n/a"})`);
    return null;
  }
};

const plan = await step("create plan (₹1,000 per additional user, monthly)", () =>
  provider.createPlan(buildProviderPlanPayload({ price_id: "smoke", code: "standard", name: "Smoke", version: 0, amount_paise: 100000, billing_period: "monthly", currency: "INR" })),
);
const created = Math.floor(Date.now() / 1000);
const sub = plan && (await step("create subscription quantity 4", () =>
  provider.createSubscription({ plan_id: plan.id, total_count: 12, quantity: 4, customer_notify: false, expire_by: created + 1800, notes: { vercentlabs_checkout_session_id: "smoke" } })));
if (sub) {
  await step("fetch subscription", () => provider.fetchSubscription(sub.id));
  await step("list subscriptions by plan and time (orphan recovery)", () => provider.listSubscriptions({ planId: plan.id, from: created - 60, to: created + 600 }));
  console.log("\nQuantity updates and cancellation need an AUTHENTICATED subscription: complete Checkout once with a test card, then call updateSubscription/cancelSubscription for it.");
}
process.exit(failures ? 1 : 0);
