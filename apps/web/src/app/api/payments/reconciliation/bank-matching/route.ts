import { z } from "zod";

import { matchBankReceipts } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: match payouts to Finance bank statement lines by payout reference (exact, or split receipts adding up).
const schema = z.object({ batchId: z.string().uuid().optional() });

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ result: await matchBankReceipts(client, context, input) }), 200, "pos.view");
}
