import { z } from "zod";

import { confirmSeatCheckout } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

const schema = z.object({
  checkoutSessionId: z.string().uuid(),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_subscription_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.checkout, (body) => schema.parse(body), async (client, session, input, provider) => ({
    ...(await confirmSeatCheckout(client, { organizationId: session.organizationId, userId: session.userId, email: session.email }, input, provider)),
    message: "Your subscription is confirmed.",
  }));
}
