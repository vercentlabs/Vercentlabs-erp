import { z } from "zod";

import { retryPosting } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Retries a failed posting in place: the journal is rebuilt from the document as it is now, never duplicated.
export async function POST(request: Request, ctx: { params: Promise<{ postingId: string }> }) {
  const { postingId } = await ctx.params;
  return accountingMutation(request, z.object({}).passthrough(), async (client, context) => ({ posting: await retryPosting(client, context, postingId) }), 200, "accounting.journal.post");
}
