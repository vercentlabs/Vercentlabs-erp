import { z } from "zod";

import { retryFailedPostings } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Retries every failed posting that can be retried from here.
export async function POST(request: Request) {
  return accountingMutation(request, z.object({ postingEvent: z.string().max(100).optional() }), async (client, context, input) => ({ result: await retryFailedPostings(client, context, input) }),
    200, "accounting.journal.post");
}
