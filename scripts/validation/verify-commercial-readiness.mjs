import fs from "node:fs";

const required = [
  ".gitattributes",
  "database/control-plane/migrations/005_billing_and_razorpay.sql",
  "apps/web/src/lib/billing.ts",
  "apps/web/src/lib/razorpay.ts",
  "apps/web/src/app/(app)/billing/page.tsx",
  "apps/web/src/components/billing-workspace.tsx",
  "apps/web/src/app/api/billing/checkout/route.ts",
  "apps/web/src/app/api/billing/verify/route.ts",
  "apps/web/src/app/api/billing/webhooks/razorpay/route.ts",
  "apps/landing/src/app/pricing/page.tsx",
  "docs/architecture/billing-and-entitlements.md",
  "docs/commercial/pricing-policy.md",
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(file)) failures.push(`Missing required file: ${file}`);
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const migration = read(
  "database/control-plane/migrations/005_billing_and_razorpay.sql",
);
for (const table of [
  "billing_plans",
  "billing_plan_prices",
  "billing_customers",
  "organization_subscriptions",
  "billing_checkout_sessions",
  "billing_payments",
  "billing_invoices",
  "billing_webhook_events",
  "billing_usage_monthly",
  "billing_entitlement_overrides",
]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    failures.push(`Billing table contract missing: ${table}`);
  }
}

const pricing = read("apps/landing/src/app/pricing/page.tsx");
if (!pricing.includes("Unlimited users"))
  failures.push("Pricing does not state unlimited users.");
if (/per\s+(user|seat)|\/\s*(user|seat)/i.test(pricing)) {
  failures.push("Seat-based pricing language remains on the pricing page.");
}
for (const price of ["₹3,999", "₹9,999", "₹24,999", "₹60,000"]) {
  if (!pricing.includes(price))
    failures.push(`Published price missing: ${price}`);
}

const landingFiles = [];
function walkLanding(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walkLanding(full);
    else if (/\.(ts|tsx|js|jsx|md)$/.test(entry.name)) landingFiles.push(full);
  }
}
walkLanding("apps/landing/src");
const landingCommercialSource = landingFiles.map(read).join("\n");
for (const [pattern, label] of [
  [/pricing starting at ₹0/i, "old zero-price claim"],
  [/₹1,299\s*\/\s*user/i, "old per-user price"],
  [/free Starter plan for up to 3 users/i, "old free-seat plan"],
  [/Starter plan includes 100 requests per minute/i, "old API plan catalogue"],
]) {
  if (pattern.test(landingCommercialSource)) {
    failures.push(`Stale commercial claim remains: ${label}.`);
  }
}

const webhook = read("apps/web/src/app/api/billing/webhooks/razorpay/route.ts");
if (!webhook.includes("readRequestBytes") || !webhook.includes("TextDecoder"))
  failures.push("Webhook does not preserve a bounded raw request body.");
if (!webhook.includes("x-razorpay-signature"))
  failures.push("Webhook signature validation header is missing.");
if (!webhook.includes("x-razorpay-event-id"))
  failures.push("Webhook idempotency identifier is missing.");
if (!webhook.includes("processing_status = 'processing'"))
  failures.push("Webhook events are not atomically claimed for processing.");
if (!webhook.includes("processing_status = 'failed'"))
  failures.push("Failed webhooks cannot be retried safely.");

const checkout = read("apps/web/src/app/api/billing/verify/route.ts");
if (!checkout.includes("verifyRazorpayPaymentSignature"))
  failures.push("Checkout signature verification is missing.");
const checkoutCreate = read("apps/web/src/app/api/billing/checkout/route.ts");
if (!checkoutCreate.includes("checkoutEnabled"))
  failures.push("Production checkout does not have an explicit go-live gate.");
if (!checkoutCreate.includes("overlapping recurring subscriptions"))
  failures.push("Unsafe self-service plan changes are not blocked.");

const platform = read("apps/web/src/lib/platform.ts");
for (const permission of [
  "crm.view",
  "crm.leads.manage",
  "billing.view",
  "billing.manage",
]) {
  if (!platform.includes(`"${permission}"`))
    failures.push(`New-organisation role seed is missing ${permission}.`);
}
if (!platform.includes("ensureOrganizationBilling"))
  failures.push("New organisations do not receive a billing trial.");

const billingPage = read("apps/web/src/app/(app)/billing/page.tsx");
if (!billingPage.includes("requirePermission(PERMISSIONS.billingView)"))
  failures.push("Direct billing-page access is not permission protected.");

const shell = read("apps/web/src/components/app-shell.tsx");
if (!shell.includes('href: "/billing"'))
  failures.push("Billing navigation is missing.");

const billingSource = read("apps/web/src/lib/billing.ts");
if (!billingSource.includes("billing_entitlement_overrides"))
  failures.push("Entitlement overrides are not applied.");
if (!billingSource.includes("quantity + $3 <= $4"))
  failures.push("Usage limits are not incremented atomically.");
if (!billingSource.includes("assertModuleEntitlement"))
  failures.push("Module entitlements are not enforced.");

const config = read("apps/web/next.config.mjs");
for (const origin of [
  "https://checkout.razorpay.com",
  "https://api.razorpay.com",
]) {
  if (!config.includes(origin)) failures.push(`CSP origin missing: ${origin}`);
}

const env = read("apps/web/.env.example");
for (const key of [
  "RAZORPAY_KEY_ID=",
  "RAZORPAY_KEY_SECRET=",
  "RAZORPAY_WEBHOOK_SECRET=",
  "RAZORPAY_WEBHOOK_SECRET_PREVIOUS=",
  "BILLING_CHECKOUT_ENABLED=",
  "BILLING_ENFORCEMENT_MODE=",
  "BILLING_MIN_GROSS_MARGIN_PERCENT=",
]) {
  if (!env.includes(key)) failures.push(`Environment contract missing: ${key}`);
}

const mutations = [
  "apps/web/src/app/api/business-data/[resource]/route.ts",
  "apps/web/src/app/api/business-data/[resource]/[id]/route.ts",
  "apps/web/src/app/api/crm/[resource]/route.ts",
  "apps/web/src/app/api/crm/[resource]/[id]/route.ts",
  "apps/web/src/app/api/settings/[resource]/route.ts",
];
for (const file of mutations) {
  if (!read(file).includes("requireBillingWriteAccess")) {
    failures.push(`Subscription write protection missing: ${file}`);
  }
}

if (failures.length) {
  console.error("Commercial readiness verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Commercial readiness verified across ${required.length} permanent paths.`,
  );
}
