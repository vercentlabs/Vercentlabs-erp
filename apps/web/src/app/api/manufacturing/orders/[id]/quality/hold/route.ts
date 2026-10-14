import { placeQualityHold } from "@vercentlabs/api";

import { holdSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Hold output awaiting inspection for investigation: it can be neither decided nor received until released.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, holdSchema, async (client, context, input) => placeQualityHold(client, context, id, input), 201);
}
