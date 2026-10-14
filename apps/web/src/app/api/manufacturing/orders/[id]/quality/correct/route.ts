import { correctQualityDecision } from "@vercentlabs/api";

import { correctionSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Move output between accepted (not yet received) and rejected (not yet scrapped) after a quality review or documented rework.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, correctionSchema, async (client, context, input) => correctQualityDecision(client, context, id, input), 201);
}
