import { z } from "zod";

import { recordStaticUpiPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Record a payment to the shop's verified static UPI QR with its UTR (only where an administrator enabled it). It is externally attested,
// never provider verified, until a settlement matches the UTR. A customer's screenshot is not proof.
const schema = z.object({
  utr: z.string().trim().min(6).max(35),
  amount: z.union([z.string().trim().max(30), z.number()]).nullish(),
  attested: z.boolean(),
  approvalId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    attempt: await recordStaticUpiPayment(client, context, checkoutId, { ...input, amount: input.amount === undefined || input.amount === null ? null : String(input.amount) }),
  }), 200, "pos.sale.create");
}
