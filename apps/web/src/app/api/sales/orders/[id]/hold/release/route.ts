import { z } from "zod";

import { releaseOrderHold } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ holdId: z.string().uuid(), note: z.string().trim().max(2000).nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.hold", schema, async (client, context, input) => ({ result: await releaseOrderHold(client, context, id, input) }));
}
