import { z } from "zod";

import { cancelSalesAdvancePayment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F052: cancel or refund an advance that has not been applied to an invoice.
const schema = z.object({ reason: z.string().trim().max(1000), refunded: z.boolean().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.request", schema, async (client, context, input) => ({ result: await cancelSalesAdvancePayment(client, context, id, input) }));
}
