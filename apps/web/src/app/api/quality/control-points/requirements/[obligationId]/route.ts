import { getInspectionObligation } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// One inspection requirement: its versions, gate, inspection, waivers and history.
export async function GET(request: Request, ctx: { params: Promise<{ obligationId: string }> }) {
  const { obligationId } = await ctx.params;
  return qualityRead(request, async (client, context) => getInspectionObligation(client, context, obligationId));
}
