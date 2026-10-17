import { getTimeBillingInvoiceCandidates } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The confirmed invoice lines that could carry this request, and the credit notes against its invoice.
type Params = { params: Promise<{ requestId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { requestId } = await ctx.params;
  return projectsRead(request, async (client, context) => getTimeBillingInvoiceCandidates(client, context, requestId));
}
