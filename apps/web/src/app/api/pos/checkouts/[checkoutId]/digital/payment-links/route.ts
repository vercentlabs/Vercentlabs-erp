import { z } from "zod";

import { startPosUpiPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// A provider-hosted payment link for what is due (where the provider offers it and the outlet enables it). Sending it to the customer's
// phone or email needs their consent. A link is never a receipt: the sale completes only when the provider confirms the payment.
const schema = z.object({
  method: z.enum(["upi", "wallet", "bank_transfer"]).optional(),
  amount: z.union([z.string().trim().max(30), z.number()]).nullish(),
  contact: z.string().trim().max(120).nullish(),
  consent: z.boolean().optional(),
  expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().min(8).max(100),
  outcome: z.string().trim().max(40).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    attempt: await startPosUpiPayment(client, context, checkoutId, { ...input, mode: "payment_link", amount: input.amount === undefined || input.amount === null ? null : String(input.amount) }),
  }), 200, "pos.sale.create");
}
