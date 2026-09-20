import { closeSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { emptySchema } from "@/features/sales/shared/schemas";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.confirm", emptySchema, async (client, context) => ({ result: await closeSalesOrder(client, context, id) }));
}
