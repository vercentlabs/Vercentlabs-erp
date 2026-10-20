import { getIncomingInspection } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// The delivery status of the inspected line — the delivery, what Quality cleared, what can be dispatched now and the hold on rejected units — read from their owners.
type Params = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    const detail = await getIncomingInspection(client, context, inspectionId);
    return { id: detail.id, number: detail.number, dispatchStatus: detail.dispatchStatus };
  }, "quality.dispatch.view");
}
