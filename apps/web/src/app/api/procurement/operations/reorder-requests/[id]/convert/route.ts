import { z } from "zod";

import { convertReorderRequestToPurchaseOrder } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return procurementMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ result: await convertReorderRequestToPurchaseOrder(client, context, id) }), 201);
}
