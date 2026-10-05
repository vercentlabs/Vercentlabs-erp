import { z } from "zod";

import { rejectQuotationApproval } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The approver sends the quotation back to Draft, saying why.
const schema = z.object({ reason: z.string().trim().min(5, "Say why the approval is rejected (at least 5 characters).").max(2000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.approve", schema, async (client, context, input) => ({ result: await rejectQuotationApproval(client, context, id, input.reason) }));
}
