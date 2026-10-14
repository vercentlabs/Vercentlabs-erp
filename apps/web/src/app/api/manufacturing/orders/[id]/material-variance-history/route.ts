import { getMoVarianceHistory } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's material variance history: exceptions, reviews, resolutions, follow-ups and the final figures.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ history: await getMoVarianceHistory(client, context, id) }));
}
