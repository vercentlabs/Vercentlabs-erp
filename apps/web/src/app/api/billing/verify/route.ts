import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { replaceOrganizationSubscription } from "@/lib/billing";
import { verifyCheckoutSchema } from "@/lib/billing-validation";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { verifyRazorpayPaymentSignature } from "@/lib/razorpay";
import { assertSameOrigin, audit } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.billingCheckout);
    const input = verifyCheckoutSchema.parse(await readJson(request));
    const rows = await query<{
      id: string;
      subscription_id: string | null;
      plan_price_id: string;
      provider_subscription_id: string;
      status: string;
    }>(
      `
        SELECT id, subscription_id, plan_price_id, provider_subscription_id, status
        FROM billing_checkout_sessions
        WHERE id = $1 AND organization_id = $2
      `,
      [input.checkoutSessionId, session.organizationId],
    );
    const checkout = rows[0];
    if (!checkout)
      throw new HttpError(404, "Billing checkout session was not found.");
    if (checkout.provider_subscription_id !== input.razorpay_subscription_id) {
      throw new HttpError(
        400,
        "The subscription returned by Checkout does not match the server session.",
      );
    }
    verifyRazorpayPaymentSignature({
      paymentId: input.razorpay_payment_id,
      subscriptionId: checkout.provider_subscription_id,
      signature: input.razorpay_signature,
    });

    const localSubscription = await replaceOrganizationSubscription({
      organizationId: session.organizationId,
      planPriceId: checkout.plan_price_id,
      providerSubscriptionId: checkout.provider_subscription_id,
      checkoutSessionId: checkout.id,
    });

    await transaction(async (client) => {
      await client.query(
        `UPDATE billing_checkout_sessions SET status = 'authorised' WHERE id = $1`,
        [checkout.id],
      );
      await client.query(
        `
          UPDATE organization_subscriptions
          SET status = 'authenticated', provider_status = 'authenticated',
            current_period_started_at = COALESCE(current_period_started_at, now()),
            grace_ends_at = NULL
          WHERE id = $1 AND organization_id = $2
        `,
        [localSubscription.id, session.organizationId],
      );
      await client.query(
        `
          INSERT INTO billing_payments (
            organization_id, subscription_id, provider_payment_id, status, provider_snapshot
          ) VALUES ($1, $2, $3, 'authorised', $4::jsonb)
          ON CONFLICT (provider, provider_payment_id) DO UPDATE SET
            status = EXCLUDED.status,
            provider_snapshot = billing_payments.provider_snapshot || EXCLUDED.provider_snapshot
        `,
        [
          session.organizationId,
          localSubscription.id,
          input.razorpay_payment_id,
          JSON.stringify({ checkout_verified: true }),
        ],
      );
    });

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "billing.checkout.verified",
      entityType: "organization_subscription",
      entityId: localSubscription.id,
      afterData: {
        providerSubscriptionId: checkout.provider_subscription_id,
        providerPaymentId: input.razorpay_payment_id,
      },
      request,
    });
    return ok({
      message:
        "Subscription authorisation verified. Razorpay webhooks will confirm activation.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
