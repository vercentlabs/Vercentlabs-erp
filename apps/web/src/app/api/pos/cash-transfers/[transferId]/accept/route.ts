import { z } from "zod";

import { acceptCashCustodyTransfer } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ transferId: string }> };

// POST: the named manager (or for the safe, a supervisor at the outlet) accepts the cash and says what was received — never the closer.
const schema = z.object({ receivedAmount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/), note: z.string().trim().max(300).optional() });

export async function POST(request: Request, { params }: Params) {
  const { transferId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ transfer: await acceptCashCustodyTransfer(client, context, transferId, input) }), 200, "pos.view");
}
