import { z } from "zod";

import { cancelPaidSubscription } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

const schema = z.object({ cancelAtCycleEnd: z.boolean().default(true) });

export async function POST(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.manage, (body) => schema.parse(body ?? {}), async (client, session, input, provider) => ({
    ...(await cancelPaidSubscription(client, { organizationId: session.organizationId, userId: session.userId, email: session.email }, input as { cancelAtCycleEnd: boolean }, provider)),
  }));
}
