import { getTimeBillingRequest } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One billing request: its allocations and their history, and what the person may do with it.
type Params = { params: Promise<{ requestId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { requestId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ request: await getTimeBillingRequest(client, context, requestId) }));
}
