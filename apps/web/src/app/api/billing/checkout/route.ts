import { randomUUID } from "node:crypto";

import { buildRazorpaySubscriptionPayload } from "@vercent/api";

import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { checkoutSchema } from "@/lib/billing-validation";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { razorpayConfiguration, razorpayRequest } from "@/lib/razorpay";
import { assertSameOrigin, audit } from "@/lib/security";

type RazorpaySubscription = { id: string; status: string; short_url?: string };

export async function POST(request: Request) {
  let checkoutSessionId: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.billingCheckout);
    const initialConfig = razorpayConfiguration();
    if (!initialConfig.checkoutEnabled) {
      throw new HttpError(
        503,
        "Online subscription checkout is not enabled for this environment.",
      );
    }
    const { planPriceId } = checkoutSchema.parse(await readJson(request));
    const priceRows = await query<{
      id: string;
      billing_period: "monthly" | "yearly";
      amount_paise: string | number;
      onboarding_fee_paise: string | number;
      currency: string;
      provider_plan_id: string | null;
      version: number;
      plan_code: string;
      plan_name: string;
      description: string;
    }>(
      `
        SELECT price.id, price.billing_period, price.amount_paise,
          price.onboarding_fee_paise, price.currency, price.provider_plan_id,
          price.version, plan.code AS plan_code, plan.name AS plan_name,
          plan.description
        FROM billing_plan_prices price
        JOIN billing_plans plan ON plan.id = price.plan_id
        WHERE price.id = $1 AND price.active AND plan.status = 'active' AND plan.is_public
      `,
      [planPriceId],
    );
    const price = priceRows[0];
    if (!price)
      throw new HttpError(404, "The selected plan price is unavailable.");

    const currentRows = await query<{
      plan_price_id: string;
      provider_subscription_id: string | null;
      status: string;
    }>(
      `
        SELECT plan_price_id, provider_subscription_id, status
        FROM organization_subscriptions
        WHERE organization_id = $1
        LIMIT 1
      `,
      [session.organizationId],
    );
    const current = currentRows[0];
    if (
      current?.provider_subscription_id &&
      ["authenticated", "active"].includes(current.status)
    ) {
      if (current.plan_price_id === price.id) {
        throw new HttpError(
          409,
          "This organisation already has the selected active subscription.",
        );
      }
      throw new HttpError(
        409,
        "Self-service plan changes are temporarily blocked to prevent overlapping recurring subscriptions. Schedule cancellation or contact billing support for a controlled plan change.",
      );
    }

    if (!price.provider_plan_id) {
      throw new HttpError(
        409,
        "The selected plan is not synced with Razorpay yet. Run pnpm billing:sync-plans after adding test keys.",
      );
    }

    checkoutSessionId = randomUUID();
    await query(
      `
        UPDATE billing_checkout_sessions SET status = 'superseded'
        WHERE organization_id = $1 AND status = 'created'
      `,
      [session.organizationId],
    );
    await query(
      `
        INSERT INTO billing_checkout_sessions (
          id, organization_id, plan_price_id, status, initiated_by, metadata
        ) VALUES ($1, $2, $3, 'created', $4, $5::jsonb)
      `,
      [
        checkoutSessionId,
        session.organizationId,
        price.id,
        session.userId,
        JSON.stringify({ mode: razorpayConfiguration().mode }),
      ],
    );

    const providerSubscription = await razorpayRequest<RazorpaySubscription>(
      "/subscriptions",
      {
        method: "POST",
        body: buildRazorpaySubscriptionPayload({
          providerPlanId: price.provider_plan_id,
          billingPeriod: price.billing_period,
          onboardingFeePaise: Number(price.onboarding_fee_paise),
          currency: price.currency,
          organizationId: session.organizationId,
          planCode: price.plan_code,
          planName: price.plan_name,
          planPriceId: price.id,
          checkoutSessionId,
        }),
      },
    );

    await query(
      `
        UPDATE billing_checkout_sessions
        SET provider_subscription_id = $2
        WHERE id = $1 AND organization_id = $3
      `,
      [checkoutSessionId, providerSubscription.id, session.organizationId],
    );

    const config = razorpayConfiguration();
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "billing.checkout.created",
      entityType: "billing_checkout_session",
      entityId: checkoutSessionId,
      afterData: {
        planCode: price.plan_code,
        billingPeriod: price.billing_period,
        providerSubscriptionId: providerSubscription.id,
      },
      request,
    });

    return ok({
      checkoutSessionId,
      keyId: config.keyId,
      providerSubscriptionId: providerSubscription.id,
      name: "VercentLabs ERP",
      description: `${price.plan_name} · ${price.billing_period}`,
      prefill: { name: session.fullName, email: session.email },
    });
  } catch (error) {
    if (checkoutSessionId) {
      await query(
        "UPDATE billing_checkout_sessions SET status = 'failed' WHERE id = $1",
        [checkoutSessionId],
      ).catch(() => undefined);
    }
    return errorResponse(error);
  }
}
