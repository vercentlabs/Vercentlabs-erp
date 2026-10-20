import { getIncomingInspection } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// One incoming inspection: its receipt, frozen specification, samples and observations (with superseded ones), reviews, dispositions,
// nonconformances, inventory status, files, history and the actions the person may take.
type Params = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return qualityRead(request, (client, context) => getIncomingInspection(client, context, inspectionId), "quality.incoming.view");
}
