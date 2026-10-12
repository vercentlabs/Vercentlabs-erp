import { z } from "zod";

import { startPosUpiPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Ask the provider for a dynamic UPI QR (or a UPI intent where offered) for what is due. The server resolves the amount, merchant, currency
// and provider; the answer is the provider's request (QR, expiry) and state, never a success that is not one. `outcome` only scripts the
// sandbox provider in development and tests.
const schema = z.object({
  mode: z.enum(["dynamic_qr", "upi_intent"]).optional(),
  amount: z.union([z.string().trim().max(30), z.number()]).nullish(),
  expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().min(8).max(100),
  outcome: z.string().trim().max(40).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    attempt: await startPosUpiPayment(client, context, checkoutId, { ...input, method: "upi", amount: input.amount === undefined || input.amount === null ? null : String(input.amount) }),
  }), 200, "pos.sale.create");
}
