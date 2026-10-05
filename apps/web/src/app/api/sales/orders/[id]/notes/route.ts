import { z } from "zod";

import { addSalesOrderNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// An internal note on the order's timeline; never printed.
const schema = z.object({ note: z.string().max(4000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.view", schema, async (client, context, input) => ({ result: await addSalesOrderNote(client, context, id, input) }));
}
