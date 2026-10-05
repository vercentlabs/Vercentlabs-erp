import { z } from "zod";

import { returnDeliveryToDraft } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Ready to dispatch → Draft, to change its lines.
const schema = z.object({ expectedVersion: z.number().int().optional(), reason: z.string().max(500).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.edit", schema, async (client, context, input) => ({ result: await returnDeliveryToDraft(client, context, id, input) }));
}
