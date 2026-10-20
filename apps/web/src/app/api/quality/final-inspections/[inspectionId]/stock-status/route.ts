import { getIncomingInspection } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// The finished-goods status of the inspected output — the order, the lot, what Quality cleared, what Manufacturing accepted and what was received into stock — read from their owners.
type Params = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    const detail = await getIncomingInspection(client, context, inspectionId);
    return { id: detail.id, number: detail.number, productionStatus: detail.productionStatus };
  }, "quality.final.view");
}
