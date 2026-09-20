import { z } from "zod";

import { submitSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ assignedTo: z.string().uuid().nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", schema, async (client, context, input) => ({ result: await submitSalesOrder(client, context, id, input.assignedTo ?? null) }));
}
