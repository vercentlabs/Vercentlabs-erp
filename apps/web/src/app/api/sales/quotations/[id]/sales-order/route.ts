import { z } from "zod";

import { createSalesOrderFromQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Accepted quotation → Sales Order, with the quoted prices. Repeating it returns the same order.
const schema = z.object({ orderDate: z.string().date().optional(), requestedDeliveryDate: z.string().date().optional(), customerPoNumber: z.string().max(120).optional(), customerPoDate: z.string().date().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", schema, async (client, context, input) => ({ result: await createSalesOrderFromQuotation(client, context, id, input) }));
}
