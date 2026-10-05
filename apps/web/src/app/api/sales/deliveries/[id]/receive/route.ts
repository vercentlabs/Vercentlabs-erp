import { z } from "zod";

import { recordDeliveryReceipt } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The customer received the goods.
const schema = z.object({ receivedBy: z.string().trim().min(1).max(160), deliveredAt: z.string().optional(), note: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({ result: await recordDeliveryReceipt(client, context, id, input) }));
}
