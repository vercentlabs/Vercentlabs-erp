import { z } from "zod";

import { returnPosCashTender } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// Hand back cash taken for a bill that will not be finalised: the cashier confirms returning the retained cash (received less change), and
// a movement takes it out of the session. Shared by /cash/return and /cash/cancel (once cash was received, cancelling is handing it back).
const schema = z.object({
  reason: z.string().trim().max(500).optional(),
  cashReturned: z.boolean(),
  returnedAmount: z.union([z.string().trim().max(30), z.number()]).nullish(),
  idempotencyKey: z.string().min(8).max(100),
});

export function cashReturnRoute(request: Request, checkoutId: string) {
  return posMutation(request, schema, async (client, context, input) => ({
    cash: await returnPosCashTender(client, context, checkoutId, {
      ...input,
      returnedAmount: input.returnedAmount === undefined || input.returnedAmount === null ? null : String(input.returnedAmount),
    }),
  }), 200, "pos.sale.create");
}
