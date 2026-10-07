import { getInspectionRejections } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// For a Quality inspection: whether it inspects goods held on a goods receipt, and the rejection cases recorded from its decision.
type Params = { params: Promise<{ inspectionId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ inspection: await getInspectionRejections(client, context, inspectionId) }), "procurement.rejections.view");
}
