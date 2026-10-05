import { validateSalesOrderForConfirmation } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What confirming this draft would find: problems that stop it, warnings, the
// comparison with the accepted quotation and any stock shortage. Changes nothing.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ check: await validateSalesOrderForConfirmation(client, context, id) }));
}
