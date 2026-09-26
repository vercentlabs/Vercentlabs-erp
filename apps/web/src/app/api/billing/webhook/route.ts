import { ingestBillingWebhook, MAX_WEBHOOK_BODY_BYTES, readRequestBytes } from "@vercentlabs/api";

import { withIngressClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { billingProvider } from "@/features/billing/provider";

// Public by design: Razorpay calls this without an ERP session. The HMAC over
// the exact raw bytes is the credential, checked before parsing. The body is
// read with a hard size limit. This route only stores the event (deduplicated
// by provider event id) and returns 2xx quickly; the worker applies it.
// A non-2xx response makes the provider retry.
export async function POST(request: Request) {
  try {
    const rawBody = Buffer.from(await readRequestBytes(request, MAX_WEBHOOK_BODY_BYTES)).toString("utf8");
    const result = await withIngressClient((client) =>
      ingestBillingWebhook(
        client,
        { rawBody, signature: request.headers.get("x-razorpay-signature"), eventIdHeader: request.headers.get("x-razorpay-event-id") },
        billingProvider(),
      ),
    );
    return ok({ received: true, duplicate: result.duplicate });
  } catch (error) {
    return errorResponse(error);
  }
}
