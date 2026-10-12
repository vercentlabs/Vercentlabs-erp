import { z } from "zod";

import { processPosRefundProviderEvent } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: a provider's refund outcome (for reconciliation users and provider relays): applied once — duplicates change nothing, a final outcome is
// never undone, an amount mismatch opens an exception.
const schema = z.object({ providerRefundReference: z.string().trim().min(1).max(120), status: z.string().trim().min(1).max(40), amount: z.string().trim().max(30).nullish() });

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ result: await processPosRefundProviderEvent(client, context, input) }), 200, "pos.reconciliation.manage");
}
