import { getSalesCustomerCreditExposure } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// F053: the same exposure order confirmation checks — unpaid invoices net of
// unapplied receipts, plus the not-yet-invoiced part of open orders.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => ({
    credit: await getSalesCustomerCreditExposure(client, context, id),
  }));
}
