import { z } from "zod";

import { resolveManufacturingException } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Resolve an exception on the order.
const schema = z.object({ resolution: z.string().max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string; exceptionId: string }> }) {
  const { id, exceptionId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ order: await resolveManufacturingException(client, context, id, exceptionId, input) }));
}
