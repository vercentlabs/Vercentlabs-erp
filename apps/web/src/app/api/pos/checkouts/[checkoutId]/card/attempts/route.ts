import { z } from "zod";

import { startPosCardPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Send a card payment to a terminal. The server works out the amount (what is due, or the card part of a split), the currency and the
// merchant account; the answer is the provider's state (AWAITING_CUSTOMER, CAPTURED, DECLINED, UNKNOWN ...), never an assumed success.
// `outcome` only scripts the sandbox provider in development and tests.
const schema = z.object({
  terminalId: z.string().uuid(),
  amount: z.union([z.string().trim().max(30), z.number()]).nullish(),
  expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().min(8).max(100),
  outcome: z.string().trim().max(40).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    attempt: await startPosCardPayment(client, context, checkoutId, { ...input, amount: input.amount === undefined || input.amount === null ? null : String(input.amount) }),
  }), 200, "pos.sale.create");
}
