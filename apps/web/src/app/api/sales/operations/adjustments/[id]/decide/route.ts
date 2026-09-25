import { z } from "zod";

import { decideSalesCreditAdjustment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F055: approve or reject a credit note / refund request; Accounting then posts it.
const schema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(2000).nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.credit.override", schema, async (client, context, input) => ({ result: await decideSalesCreditAdjustment(client, context, id, input) }));
}
