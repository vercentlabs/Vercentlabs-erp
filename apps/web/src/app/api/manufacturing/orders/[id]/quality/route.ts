import { getMoQualitySummary } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's quality: output by entry (awaiting, held, accepted, rejected), its inspections, holds and corrections.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ quality: await getMoQualitySummary(client, context, id) }));
}
