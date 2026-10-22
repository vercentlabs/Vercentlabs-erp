import { getSalesPayment } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// One payment received with the bills it settled (Sales plan). The operation checks the payments permission and the customer's scope.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => getSalesPayment(client, context, id));
}
