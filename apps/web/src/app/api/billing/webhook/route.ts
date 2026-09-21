import { createRazorpayProvider, handleBillingWebhook } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";

// Public by design: the payment provider's servers call this with no ERP session. The HMAC signature over the exact
// raw bytes is the credential, checked before the body is parsed. Failures return a non-2xx so the provider retries;
// every event is stored once (by provider event id) and replays are harmless.
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const result = await withClient((client) =>
      handleBillingWebhook(client, { rawBody, signature: request.headers.get("x-razorpay-signature"), eventId: request.headers.get("x-razorpay-event-id") }, createRazorpayProvider(process.env)),
    );
    return ok({ received: true, duplicate: result.duplicate });
  } catch (error) {
    return errorResponse(error);
  }
}
