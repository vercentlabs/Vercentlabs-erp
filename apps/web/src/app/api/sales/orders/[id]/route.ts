import { getSalesOrder, updateSalesOrder } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ order: await getSalesOrder(client, context, id) }));
}

// Saves changes to a Draft; expectedVersionNumber guards against overwriting someone else's change.
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", documentSchema, async (client, context, input) => ({ order: await updateSalesOrder(client, context, id, input) }));
}
