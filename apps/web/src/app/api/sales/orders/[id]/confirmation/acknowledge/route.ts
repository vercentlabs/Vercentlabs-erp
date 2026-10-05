import { z } from "zod";

import { recordCustomerAcknowledgement } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The customer acknowledged the confirmation. Never required for fulfillment.
const schema = z.object({ acknowledgedAt: z.string().max(40).optional(), reference: z.string().max(300).optional(), note: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.confirmation.acknowledge", schema, async (client, context, input) => ({ result: await recordCustomerAcknowledgement(client, context, id, input) }));
}
