import { z } from "zod";

import { cancelSplitCheckout } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Cancel a bill being paid (PAYMENT_VOID_PENDING): every collected part is compensated — card / UPI refunded through the provider, cash
// handed back once the cashier confirms it (cashReturned) — and open attempts are cancelled. The bill returns to editing only when every
// part is resolved; otherwise the answer says what is still outstanding.
const schema = z.object({
  reason: z.string().trim().max(200).optional(),
  cashReturned: z.boolean().optional(),
  approvalId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => cancelSplitCheckout(client, context, checkoutId, input), 200, "pos.sale.create");
}
