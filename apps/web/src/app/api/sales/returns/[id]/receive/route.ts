import { z } from "zod";

import { completeSalesReturnWithStock } from "@vercentlabs/api";

import { stockContextFor } from "@/features/sales/orders/server/stock-context";
import { salesMutation } from "@/features/sales/shared/route-helpers";
import { HttpError } from "@/core/http";

const schema = z.object({
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]), disposition: z.enum(["restock", "scrap"]) })).max(500).optional(),
});

// F054: receive an approved return — restocked lines go back into stock,
// scrapped lines don't; the returned quantity is recorded on the order.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => {
    const found = await client.query(
      `SELECT orders.company_id FROM tenant.sales_return_requests request JOIN tenant.sales_orders orders ON orders.id=request.sales_order_id WHERE request.organization_id=$1 AND request.id=$2`,
      [context.organizationId, id],
    );
    if (!found.rows[0]) throw new HttpError(404, "Return request not found.");
    const stock = stockContextFor({ organizationId: context.organizationId, userId: context.userId ?? "" }, String(found.rows[0].company_id), "receive");
    return { result: await completeSalesReturnWithStock(client, context, stock, id, input) };
  });
}
