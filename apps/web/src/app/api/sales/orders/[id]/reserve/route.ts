import { z } from "zod";

import { reserveSalesOrderStock } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Reserve Available / Reserve Remaining: what each stock line still needs, from what is usable now
// (checked again under a lock); a line is reserved partly when stock is short. The key makes a retry reserve nothing twice.
const schema = z.object({ lineIds: z.array(z.string().uuid()).max(500).optional(), idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.reserve", schema, async (client, context, input) => ({ result: await reserveSalesOrderStock(client, context, id, input) }));
}
