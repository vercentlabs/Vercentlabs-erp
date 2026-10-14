import { getVarianceException, updateVarianceException } from "@vercentlabs/api";

import { updateExceptionSchema } from "@/features/manufacturing/variance/api/variance-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One variance exception: the figures it opened and was submitted with, the line now, the review, the resolution and its history.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ exception: await getVarianceException(client, context, id) }));
}

// Record the investigation (reason, explanation, evidence, owner) while it is open.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, updateExceptionSchema, async (client, context, input) => updateVarianceException(client, context, id, input));
}
