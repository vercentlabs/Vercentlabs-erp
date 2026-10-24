import { z } from "zod";

import { issueRefundVoucher } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A refund voucher (GST Rule 51) for an advance returned without a supply: { amount?, refundDate?, reason }.
const schema = z.object({ amount: z.number().positive().optional(), refundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ result: await issueRefundVoucher(client, context, id, input) }), 201);
}
