import { z } from "zod";

import { reserveSalesOrderLineFromStock } from "@vercentlabs/api";

import { orderCompanyId, stockContextFor } from "@/features/sales/orders/server/stock-context";
import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]).nullish(), idempotencyKey: z.string().trim().max(200).nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(
    request,
    "sales.fulfillment.request",
    schema,
    async (client, context, input) => {
      const companyId = await orderCompanyId(client, context.organizationId, id);
      const stock = stockContextFor({ organizationId: context.organizationId, userId: context.userId ?? "" }, companyId, "reserve");
      return { reservation: await reserveSalesOrderLineFromStock(client, context, stock, { salesOrderId: id, ...input }) };
    },
    201,
  );
}
