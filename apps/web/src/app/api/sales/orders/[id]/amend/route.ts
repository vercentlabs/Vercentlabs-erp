import { z } from "zod";

import { amendSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

const schema = documentSchema.extend({ amendmentReason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.amend", schema, async (client, context, input) => ({ detail: await amendSalesOrder(client, context, id, input) }));
}
