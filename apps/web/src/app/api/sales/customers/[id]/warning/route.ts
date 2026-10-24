import { z } from "zod";

import { setCustomerSalesWarning } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The customer's sales warning ("Cash only"), shown on their quotations and orders: { message } (empty removes it).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ message: z.string().max(300).nullable() }), async (client, context, input) => setCustomerSalesWarning(client, context, id, input));
}
