import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { cancelSubscriptionSchema } from "@/lib/billing-validation";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { razorpayRequest } from "@/lib/razorpay";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.billingManage);
    const input = cancelSubscriptionSchema.parse(await readJson(request));
    const rows = await query<{
      id: string;
      provider_subscription_id: string | null;
    }>(
      `SELECT id, provider_subscription_id FROM organization_subscriptions WHERE organization_id = $1`,
      [session.organizationId],
    );
    const subscription = rows[0];
    if (!subscription?.provider_subscription_id) {
      throw new HttpError(409, "There is no Razorpay subscription to cancel.");
    }
    await razorpayRequest(
      `/subscriptions/${encodeURIComponent(subscription.provider_subscription_id)}/cancel`,
      {
        method: "POST",
        body: { cancel_at_cycle_end: input.cancelAtCycleEnd },
      },
    );
    await query(
      `UPDATE organization_subscriptions SET cancel_at_cycle_end = $2 WHERE id = $1`,
      [subscription.id, input.cancelAtCycleEnd],
    );
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "billing.subscription.cancellation_requested",
      entityType: "organization_subscription",
      entityId: subscription.id,
      afterData: { cancelAtCycleEnd: input.cancelAtCycleEnd },
      request,
    });
    return ok({
      message: input.cancelAtCycleEnd
        ? "Cancellation is scheduled for the end of the billing cycle."
        : "Subscription cancellation was requested.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
