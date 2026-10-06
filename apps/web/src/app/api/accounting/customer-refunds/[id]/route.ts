import { z } from "zod";

import { getCustomerRefund, updateDraftRefund } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ refund: await getCustomerRefund(client, context, id) }), "accounting.refund.view");
}

// A draft's amount, date, reason, payment details and notes. The credit source stays.
const schema = z.object({
  expectedVersion: z.number().int().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  refundDate: z.string().date().optional(),
  reasonCode: z.string().max(40).optional(),
  reasonNote: z.string().max(1000).nullable().optional(),
  paymentMethod: z.string().max(40).optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
  externalReference: z.string().max(200).nullable().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await updateDraftRefund(client, context, id, input) }), 200, "accounting.refund.edit");
}
