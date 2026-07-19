import fs from "node:fs";
import path from "node:path";

const required = [
  "src/app/(app)/billing/page.tsx",
  "src/components/billing-workspace.tsx",
  "src/app/api/billing/checkout/route.ts",
  "src/app/api/billing/verify/route.ts",
  "src/app/api/billing/webhooks/razorpay/route.ts",
  "src/lib/billing.ts",
  "src/lib/razorpay.ts",
  "scripts/sync-razorpay-plans.mjs",
  "scripts/reconcile-razorpay-billing.mjs",
  "../../database/control-plane/migrations/005_billing_and_razorpay.sql",
  "../../docs/architecture/billing-and-entitlements.md",
];
for (const relative of required) {
  if (!fs.existsSync(path.resolve(process.cwd(), relative)))
    throw new Error(`Missing billing file: ${relative}`);
}
const webhook = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/billing/webhooks/razorpay/route.ts"),
  "utf8",
);
for (const contract of [
  "readRequestBytes",
  "TextDecoder",
  "x-razorpay-signature",
  "x-razorpay-event-id",
  "billing_webhook_events",
]) {
  if (!webhook.includes(contract))
    throw new Error(`Webhook contract missing: ${contract}`);
}
const config = fs.readFileSync(
  path.resolve(process.cwd(), "next.config.mjs"),
  "utf8",
);
for (const origin of [
  "https://checkout.razorpay.com",
  "https://api.razorpay.com",
  "frame-src",
]) {
  if (!config.includes(origin))
    throw new Error(`Razorpay CSP contract missing: ${origin}`);
}
const platform = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/platform.ts"),
  "utf8",
);
for (const permission of [
  "crm.view",
  "crm.leads.manage",
  "billing.view",
  "billing.checkout",
]) {
  if (!platform.includes(`"${permission}"`))
    throw new Error(`New-organisation role seed missing: ${permission}`);
}
console.log(
  `Billing and entitlement contracts verified across ${required.length} permanent paths.`,
);
