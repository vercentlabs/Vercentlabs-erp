import { z } from "zod";

import { startSeatCheckout } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

const schema = z.object({ planPriceId: z.string().uuid(), users: z.number().int().min(1).max(500) });

export async function POST(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.checkout, (body) => schema.parse(body), async (client, session, input, provider) => ({
    ...(await startSeatCheckout(client, { organizationId: session.organizationId, userId: session.userId, email: session.email }, input as { planPriceId: string; users: number }, provider, process.env)),
  }), 201);
}
