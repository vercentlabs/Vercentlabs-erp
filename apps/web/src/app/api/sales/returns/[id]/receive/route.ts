import { z } from "zod";

import { receiveSalesReturn } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The goods are back: stock returns into the warehouse (sellable or held). Receiving twice receives once.
const schema = z.object({ expectedVersion: z.number().int().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.return.receive", schema, async (client, context, input) => ({ result: await receiveSalesReturn(client, context, id, input) }));
}
