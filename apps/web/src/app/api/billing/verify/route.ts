import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { replaceOrganizationSubscriptionWithClient } from "@/lib/billing";
import { verifyCheckoutSchema } from "@/lib/billing-validation";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { verifyRazorpayPaymentSignature } from "@/lib/razorpay";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

const VERIFIABLE_CHECKOUT_STATES = [
  "created",
  "provider_link_pending",
  "provider_recovery_pending",
] as const;

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requirePermissionFromSession(session, PERMISSIONS.billingCheckout);
    const organizationId = session.organizationId;
    const input = verifyCheckoutSchema.parse(await readJson(request));

    const rows = await query<{
      id: string;
      provider_subscription_id: string | null;
      status: string;
      expires_at: Date;
    }>(
      `
        SELECT id, provider_subscription_id, status, expires_at
        FROM billing_checkout_sessions
        WHERE id = $1 AND organization_id = $2
      `,
      [input.checkoutSessionId, organizationId],
    );
    const preliminary = rows[0];
    if (!preliminary) {
      throw new HttpError(404, "Billing checkout session was not found.");
    }
    if (!VERIFIABLE_CHECKOUT_STATES.includes(
      preliminary.status as (typeof VERIFIABLE_CHECKOUT_STATES)[number],
    )) {
      throw new HttpError(
        409,
        "This billing checkout is no longer current and cannot be verified.",
      );
    }
    if (new Date(preliminary.expires_at).getTime() <= Date.now()) {
      throw new HttpError(410, "This billing checkout has expired. Start a new checkout.");
    }
    if (preliminary.provider_subscription_id !== input.razorpay_subscription_id) {
      throw new HttpError(
        400,
        "The subscription returned by Checkout does not match the server session.",
      );
    }

    verifyRazorpayPaymentSignature({
      paymentId: input.razorpay_payment_id,
      subscriptionId: input.razorpay_subscription_id,
      signature: input.razorpay_signature,
    });

    const result = await transaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`billing-checkout:${organizationId}`],
      );

      const locked = await client.query<{
        id: string;
        plan_price_id: string;
        provider_subscription_id: string | null;
        status: string;
        expires_at: Date;
      }>(
        `
          SELECT id, plan_price_id, provider_subscription_id, status, expires_at
          FROM billing_checkout_sessions
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE
        `,
        [input.checkoutSessionId, organizationId],
      );
      const checkout = locked.rows[0];
      if (!checkout) {
        throw new HttpError(404, "Billing checkout session was not found.");
      }
      if (!VERIFIABLE_CHECKOUT_STATES.includes(
        checkout.status as (typeof VERIFIABLE_CHECKOUT_STATES)[number],
      )) {
        throw new HttpError(
          409,
          "This billing checkout changed before verification completed.",
        );
      }
      if (new Date(checkout.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE billing_checkout_sessions
             SET status = 'expired', updated_at = now()
           WHERE id = $1`,
          [checkout.id],
        );
        throw new HttpError(410, "This billing checkout has expired. Start a new checkout.");
      }
      if (checkout.provider_subscription_id !== input.razorpay_subscription_id) {
        throw new HttpError(
          409,
          "This billing checkout is linked to a different provider subscription.",
        );
      }

      await client.query(
        `UPDATE billing_checkout_sessions
            SET status = 'verifying', updated_at = now(), last_error = NULL
          WHERE id = $1`,
        [checkout.id],
      );

      const localSubscription = await replaceOrganizationSubscriptionWithClient(
        client,
        {
          organizationId: organizationId,
          planPriceId: checkout.plan_price_id,
          providerSubscriptionId: checkout.provider_subscription_id,
          checkoutSessionId: checkout.id,
        },
      );

      await client.query(
        `
          UPDATE organization_subscriptions
          SET status = 'authenticated', provider_status = 'authenticated',
            current_period_started_at = COALESCE(current_period_started_at, now()),
            grace_ends_at = NULL
          WHERE id = $1 AND organization_id = $2
        `,
        [localSubscription.id, organizationId],
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
          organizationId,
          localSubscription.id,
          input.razorpay_payment_id,
          JSON.stringify({ checkout_verified: true }),
        ],
      );
      await client.query(
        `UPDATE billing_checkout_sessions
            SET status = 'authorised', subscription_id = $2,
              provider_linked_at = COALESCE(provider_linked_at, now()),
              updated_at = now()
          WHERE id = $1`,
        [checkout.id, localSubscription.id],
      );

      await audit({
        organizationId: organizationId,
        actorUserId: session.userId,
        eventType: "billing.checkout.verified",
        entityType: "organization_subscription",
        entityId: localSubscription.id,
        afterData: {
          providerSubscriptionId: checkout.provider_subscription_id,
          providerPaymentId: input.razorpay_payment_id,
        },
        request,
        client,
      });

      return localSubscription;
    });

    return ok({
      subscriptionId: result.id,
      message:
        "Subscription authorisation verified. Razorpay webhooks will confirm activation.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
