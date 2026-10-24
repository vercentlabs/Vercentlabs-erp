import { startLinkPayment } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";

// Pay now on a shared invoice (Sales report Phase 3): a Razorpay order for what is due, and what Checkout needs to open.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  try {
    await enforcePublicRateLimits(request, [
      { bucket: "sales-link-pay", maximum: 20, windowSeconds: 600 },
      { bucket: "sales-link-pay-token", maximum: 10, windowSeconds: 3600, subject: token },
    ]);
    const checkout = await ingressTransaction((client) => startLinkPayment(client, token));
    if (!checkout) return Response.json({ ok: false, message: "This link is not valid." }, { status: 404 });
    return Response.json({ ok: true, checkout });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 500;
    const known = status >= 400 && status < 600 && status !== 500;
    return Response.json({ ok: false, message: known ? (error as Error).message : "Online payment could not be started. Try again." }, { status: known ? status : 500 });
  }
}
