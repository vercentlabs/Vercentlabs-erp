import { receiveGatewayWebhook } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

// Razorpay's webhook for a company's own account (Sales report Phase 3): payment.captured / order.paid, signed with the company's webhook
// secret over the exact body. Set this URL in the company's Razorpay dashboard.
export async function POST(request: Request, route: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await route.params;
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  try {
    const result = await ingressTransaction((client) => receiveGatewayWebhook(client, organizationId, rawBody, signature));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 500;
    return Response.json({ ok: false }, { status: status === 401 ? 401 : 500 });
  }
}
