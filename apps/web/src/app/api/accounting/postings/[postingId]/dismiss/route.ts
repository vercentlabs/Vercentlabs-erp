import { z } from "zod";

import { dismissPosting } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Closes a failed posting that is not needed, with the reason.
const schema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(request: Request, ctx: { params: Promise<{ postingId: string }> }) {
  const { postingId } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => ({ posting: await dismissPosting(client, context, postingId, input) }), 200, "accounting.journal.post");
}
