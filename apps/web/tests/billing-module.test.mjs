import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) =>
  fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("billing migration includes commercial records, module entitlements and retryable webhook processing", () => {
  const sql = read(
    "../../database/control-plane/migrations/005_billing_and_razorpay.sql",
  );
  for (const table of [
    "billing_plans",
    "billing_plan_prices",
    "organization_subscriptions",
    "billing_payments",
    "billing_invoices",
    "billing_webhook_events",
    "billing_usage_monthly",
    "billing_entitlement_overrides",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE \(provider, provider_event_id\)/);
  assert.match(sql, /'processing'/);
  assert.match(sql, /modules_snapshot/);
  assert.match(sql, /'launch', 'monthly', 399900/);
  assert.match(sql, /'growth', 'monthly', 999900/);
  assert.match(sql, /'scale', 'monthly', 2499900/);
});

test("Razorpay integration verifies checkout and safely retries failed webhooks", () => {
  const payment = read("src/lib/razorpay.ts");
  const webhook = read("src/app/api/billing/webhooks/razorpay/route.ts");
  assert.match(payment, /paymentId}\|\${input\.subscriptionId/);
  assert.match(payment, /timingSafeEqual/);
  assert.match(webhook, /readRequestBytes\(request, maximumBytes\)/);
  assert.match(webhook, /RAZORPAY_WEBHOOK_MAX_BYTES/);
  assert.match(webhook, /payload_hash/);
  assert.match(webhook, /accepted time window/);
  assert.match(webhook, /x-razorpay-event-id/);
  assert.match(webhook, /processing_status = 'processing'/);
  assert.match(webhook, /processing_status = 'failed'/);
});

test("pricing is organisation based and avoids seat multiplication", () => {
  const landing = read("../landing/src/app/pricing/page.tsx");
  assert.match(landing, /Unlimited users/);
  assert.doesNotMatch(landing, /per user|\/user|per seat/i);
  assert.match(landing, /₹3,999/);
  assert.match(landing, /₹9,999/);
  assert.match(landing, /₹24,999/);
});

test("billing access is permission-protected and role seeds do not expose invoices to ordinary users", () => {
  const platform = read("src/lib/platform.ts");
  const page = read("src/app/(app)/billing/page.tsx");
  for (const permission of [
    "crm.view",
    "crm.leads.manage",
    "crm.opportunities.manage",
    "billing.view",
    "billing.manage",
    "billing.checkout",
  ]) {
    assert.match(
      platform,
      new RegExp(`"${permission.replaceAll(".", "\\.")}"`),
    );
  }
  assert.match(platform, /ensureOrganizationBilling/);
  assert.match(page, /requirePermission\(PERMISSIONS\.billingView\)/);
  const employeeBlock = platform.slice(
    platform.indexOf('if (slug === "employee")'),
    platform.indexOf('if (slug === "auditor")'),
  );
  assert.doesNotMatch(employeeBlock, /billing\.view/);
});

test("usage increments are atomic and modules are gated by subscription entitlements", () => {
  const billing = read("src/lib/billing.ts");
  const moduleRoute = read("src/app/api/modules/[key]/route.ts");
  assert.match(billing, /quantity \+ \$3 <= \$4/);
  assert.match(billing, /billing_entitlement_overrides/);
  assert.match(billing, /assertModuleEntitlement/);
  assert.match(moduleRoute, /assertModuleEntitlement/);
});
