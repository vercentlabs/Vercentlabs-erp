import { z } from "zod";

import { reopenSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Confirmed → Draft, while nothing has been delivered or invoiced; reservations are released.
const schema = z.object({ reason: z.string().max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.reopen", schema, async (client, context, input) => ({ result: await reopenSalesOrder(client, context, id, input) }));
}
