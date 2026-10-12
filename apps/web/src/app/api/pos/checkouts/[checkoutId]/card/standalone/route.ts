import { z } from "zod";

import { recordStandaloneCardPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Record a payment taken on a standalone bank card machine (only where the outlet allows it): the machine's approval reference and the
// cashier's confirmation that it showed approved. It is externally attested, never "bank verified", until settlement confirms it.
const schema = z.object({
  terminalId: z.string().uuid(),
  amount: z.union([z.string().trim().max(30), z.number()]).nullish(),
  reference: z.string().trim().min(4).max(40),
  attested: z.boolean(),
  cardLastFour: z.string().trim().regex(/^\d{4}$/).nullish(),
  cardNetwork: z.string().trim().max(20).nullish(),
  approvalId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    attempt: await recordStandaloneCardPayment(client, context, checkoutId, { ...input, amount: input.amount === undefined || input.amount === null ? null : String(input.amount) }),
  }), 200, "pos.sale.create");
}
