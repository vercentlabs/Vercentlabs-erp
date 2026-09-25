import { rejectQuotationApproval } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { z } from "zod";

// F041: a rejection always says why; the reason is kept on the document.
const rejectSchema = z.object({ reason: z.string().trim().min(5, "Say why the approval is rejected (at least 5 characters).").max(2000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.approve", rejectSchema, async (client, context, input) => {
    await rejectQuotationApproval(client, context, id, input.reason);
    return { result: { quotationId: id, status: "draft" } };
  });
}
