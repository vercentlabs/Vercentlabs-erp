import { z } from "zod";

import { confirmSeatCheckout } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { billingProvider } from "@/features/billing/provider";

const schema = z.object({
  checkoutSessionId: z.string().uuid(),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_subscription_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

// Signature checked against the server-stored subscription id; entitlement
// changes only after the provider confirms. Returns state "active" or "pending".
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.checkout, transaction: "none", action: "billing.checkout.verify", auditDenial: true },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      const ctx = { organizationId: session.organizationId, userId: session.userId, email: session.email };
      return ok(await confirmSeatCheckout(client, ctx, body, billingProvider()));
    },
  );
}
