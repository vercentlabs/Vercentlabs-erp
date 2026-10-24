import { confirmLinkPayment } from "@vercentlabs/api";

import { sharedAnswer } from "../../../../shared-answer";

// Checkout's answer: { orderId, paymentId, signature }. The receipt is recorded once (the webhook records it too if this never arrives).
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  return sharedAnswer(request, token, "The payment could not be confirmed here. If money left your account it will show on the invoice shortly.", (client, body) =>
    confirmLinkPayment(client, token, { orderId: String(body.orderId ?? ""), paymentId: String(body.paymentId ?? ""), signature: String(body.signature ?? "") }));
}
