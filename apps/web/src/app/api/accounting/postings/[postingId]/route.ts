import { getPosting } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// One posting with its full attempt history.
export async function GET(request: Request, ctx: { params: Promise<{ postingId: string }> }) {
  const { postingId } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ posting: await getPosting(client, context, postingId) }));
}
