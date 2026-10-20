import { getNonconformance } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// One NCR: affected items, source inspection and failed observations, containment, investigation, actions, verification, dependencies,
// evidence, history and what the person may do.
type Params = { params: Promise<{ ncId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { ncId } = await ctx.params;
  return qualityRead(request, (client, context) => getNonconformance(client, context, ncId), "quality.nonconformance.view");
}
