import { z } from "zod";

import { confirmPosCashPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// The cashier confirms having physically received the cash. The server works out what it settles and the change, records the tender and
// its cash movements against the session, and finalises the sale through the one checkout path. The answer is what really happened:
// COMPLETED, or CASH_RECEIVED_PENDING_FINALIZATION with what to do next. A retry returns the original outcome.
const schema = z.object({
  cashReceived: z.union([z.string().trim().max(30), z.number()]),
  changeGiven: z.union([z.string().trim().max(30), z.number()]).nullish(),
  currency: z.string().trim().max(3).optional(),
  split: z.boolean().optional(),
  expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    cash: await confirmPosCashPayment(client, context, checkoutId, {
      ...input,
      cashReceived: String(input.cashReceived),
      changeGiven: input.changeGiven === undefined || input.changeGiven === null ? null : String(input.changeGiven),
    }),
  }), 200, "pos.sale.create");
}
