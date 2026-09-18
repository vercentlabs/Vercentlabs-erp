import { errorResponse, fail, ok } from "@/core/http";
import { tenantTransaction } from "@/core/db";
import { handlePosPaymentWebhook, resolvePaymentAdapter } from "@vercentlabs/api";

// F283/F284/F285/F286 provider webhook. This route is DELIBERATELY NOT
// session-authenticated: a payment provider's own servers call it
// directly, with no ERP session/cookie to present. Its authentication is
// the provider's own cryptographic signature instead (verified below via
// the exact same adapter.verifyWebhookSignature the domain function uses
// a second time inside the transaction), the same pattern this codebase
// already establishes for inbound-mail webhooks
// (services/api/src/core/inbound-mail.js's verifyInboundMailSignature) --
// there is no other existing "unauthenticated but cryptographically
// verified" inbound endpoint in apps/web to point to directly, so this
// route follows that inbound-mail precedent's shape.
//
// The raw body is read as TEXT, not parsed JSON: signature verification
// must run against the exact bytes the provider signed, before anything
// is trusted enough to even look at.
//
// A real (non-sandbox) provider's webhook secret would be resolved from
// tenant.pos_payment_provider_configs' credential_env_var, scoped to the
// specific store/provider the payload claims -- not a single global
// secret. The sandbox adapter, by contrast, uses one shared
// POS_SANDBOX_PAYMENT_WEBHOOK_SECRET env var for the whole environment,
// which is disclosed here as a sandbox-only simplification: it is
// sufficient to prove the real HMAC-verify code path end-to-end, but it is
// not the per-tenant-secret model a genuine multi-merchant production
// integration would need once a real provider adapter is built.
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await context.params;
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-pos-payment-signature");

    const adapter = resolvePaymentAdapter(provider);
    if (!adapter.verifyWebhookSignature(rawBody, signatureHeader)) {
      return fail("The webhook signature could not be verified.", 401, { code: "POS_PAYMENT_WEBHOOK_SIGNATURE_INVALID" });
    }
    let organizationId: string | undefined;
    try {
      organizationId = adapter.parseWebhookEvent(rawBody).organizationId;
    } catch {
      return fail("The webhook payload could not be parsed.", 400, { code: "POS_PAYMENT_WEBHOOK_PAYLOAD_INVALID" });
    }
    if (!organizationId) {
      return fail("The webhook payload is missing an organization id.", 400, { code: "POS_PAYMENT_WEBHOOK_PAYLOAD_INVALID" });
    }

    const result = await tenantTransaction(organizationId, async (client) =>
      handlePosPaymentWebhook(client, { providerKey: provider, rawBody, signatureHeader }),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
