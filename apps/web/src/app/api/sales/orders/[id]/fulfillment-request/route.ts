import { z } from "zod";

import { createFulfillmentRequest } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ idempotencyKey: z.string().trim().min(1).max(200) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({ request: await createFulfillmentRequest(client, context, id, input.idempotencyKey) }), 201);
}
