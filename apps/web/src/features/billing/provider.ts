import "server-only";

import { BillingServiceError, createRazorpayProvider, validateRazorpayConfig } from "@vercentlabs/api";

// The server-side payment provider for Billing routes. Secrets stay here; only
// the public key id is ever returned to the browser (inside a checkout response).
// A misconfigured provider fails obviously in production instead of silently
// behaving differently.
export function billingProvider() {
  if (process.env.NODE_ENV === "production") {
    const problems = validateRazorpayConfig(process.env);
    if (problems.length) {
      console.error(JSON.stringify({ level: "error", service: "billing", message: "billing.provider.misconfigured", problems }));
      throw new BillingServiceError(503, "Online billing is temporarily unavailable. Contact support.", "BILLING_PROVIDER_MISCONFIGURED");
    }
  }
  return createRazorpayProvider(process.env);
}
