import { z } from "zod";

import { postCustomerRefund } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Posts the refund: checked again against the credit left, the credit consumed, the bank or cash account credited. Posting twice posts once.
const schema = z.object({
  expectedVersion: z.number().int().optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
  paymentMethod: z.string().max(40).optional(),
  externalReference: z.string().max(200).nullable().optional(),
  refundDate: z.string().date().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await postCustomerRefund(client, context, id, input) }), 200, "accounting.refund.post");
}
