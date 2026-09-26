import { z } from "zod";

import { completeSalesReturnWithStock, salesReturnRequestCompanyId } from "@vercentlabs/api";

import { stockContextFor } from "@/features/sales/orders/server/stock-context";
import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]), disposition: z.enum(["restock", "scrap"]) })).max(500).optional(),
});

// F054: receive an approved return — restocked lines go back into stock,
// scrapped lines don't; the returned quantity is recorded on the order.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => {
    const companyId = await salesReturnRequestCompanyId(client, context.organizationId, id);
    const stock = stockContextFor({ organizationId: context.organizationId, userId: context.userId ?? "" }, companyId, "receive");
    return { result: await completeSalesReturnWithStock(client, context, stock, id, input) };
  });
}
