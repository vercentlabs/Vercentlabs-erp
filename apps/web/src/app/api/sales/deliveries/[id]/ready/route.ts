import { z } from "zod";

import { markDeliveryReady } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Draft → Ready to dispatch.
const schema = z.object({ expectedVersion: z.number().int().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.edit", schema, async (client, context, input) => ({ result: await markDeliveryReady(client, context, id, input) }));
}
