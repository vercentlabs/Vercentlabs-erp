import { syncSubscriptionFromProvider } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

// Pulls the subscription's current state from the payment provider, for when a webhook is delayed.
export async function POST(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.manage, () => ({}), async (client, session, _input, provider) => ({
    ...(await syncSubscriptionFromProvider(client, { organizationId: session.organizationId, userId: session.userId }, provider)),
  }));
}
