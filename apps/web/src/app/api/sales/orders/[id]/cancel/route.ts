import { z } from "zod";

import { cancelSalesOrderWithCrmSync } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.cancel", schema, async (client, context, input) => ({ result: await cancelSalesOrderWithCrmSync(client, context, id, input.reason) }));
}
