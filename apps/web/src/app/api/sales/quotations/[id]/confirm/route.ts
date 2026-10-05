import { z } from "zod";

import { confirmQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Draft → Confirmed, after the checks; above the approval thresholds it goes for approval first.
const schema = z.object({ expectedVersionNumber: z.number().int().positive().optional(), assignedTo: z.string().uuid().nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.confirm", schema, async (client, context, input) => ({ result: await confirmQuotation(client, context, id, input) }));
}
