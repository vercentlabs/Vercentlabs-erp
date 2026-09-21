import { z } from "zod";

import { confirmSeatCheckout, syncSubscriptionFromProvider } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

const schema = z.object({
  checkoutSessionId: z.string().uuid(),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_subscription_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.checkout, (body) => schema.parse(body), async (client, session, input, provider) => {
    const ctx = { organizationId: session.organizationId, userId: session.userId, email: session.email };
    const confirmed = await confirmSeatCheckout(client, ctx, input, provider);
    // Bring the plan up to date now rather than waiting for the webhook; a failure here is not a failed payment.
    const synced = await syncSubscriptionFromProvider(client, ctx, provider).catch(() => ({ synced: false }));
    return { ...confirmed, synced: synced.synced, message: "Your subscription is confirmed." };
  });
}
