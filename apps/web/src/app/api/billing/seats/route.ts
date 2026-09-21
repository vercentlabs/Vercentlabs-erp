import { z } from "zod";

import { changeSubscriptionSeats } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

const schema = z.object({ users: z.number().int().min(1).max(500) });

export async function POST(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.manage, (body) => schema.parse(body), async (client, session, input, provider) => ({
    ...(await changeSubscriptionSeats(client, { organizationId: session.organizationId, userId: session.userId, email: session.email }, input as { users: number }, provider)),
  }));
}
