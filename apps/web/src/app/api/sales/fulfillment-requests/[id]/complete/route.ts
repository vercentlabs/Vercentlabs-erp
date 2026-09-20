import { z } from "zod";

import { completeFulfillmentRequestWithStockMovement } from "@vercentlabs/api";

import { requestCompanyId, stockContextFor } from "@/features/sales/orders/server/stock-context";
import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), fulfilledQuantity: z.union([z.number(), z.string()]) })).min(1).max(500),
});

// Completing a delivery issues real stock; insufficient stock blocks it and rolls
// the whole transaction back (the orchestration does not swallow that error).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => {
    const companyId = await requestCompanyId(client, context.organizationId, id);
    const stock = stockContextFor({ organizationId: context.organizationId, userId: context.userId ?? "" }, companyId, "issue");
    return { detail: await completeFulfillmentRequestWithStockMovement(client, context, stock, id, input) };
  });
}
