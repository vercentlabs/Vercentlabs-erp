import { getIncomingInspection } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// One final inspection: its production context, frozen specification, samples and observations, reviews, dispositions, rework,
// nonconformances, production status, files, history and the actions the person may take.
type Params = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return qualityRead(request, (client, context) => getIncomingInspection(client, context, inspectionId), "quality.final.view");
}
