import { getQuotation, updateQuotation } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.quotation.view", async (client, context) => ({ quotation: await getQuotation(client, context, id) }));
}

// Saves changes to a Draft; expectedVersionNumber guards against overwriting someone else's change.
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.create", documentSchema, async (client, context, input) => ({ quotation: await updateQuotation(client, context, id, input) }));
}
