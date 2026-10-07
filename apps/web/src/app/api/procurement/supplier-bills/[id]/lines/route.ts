import { addDirectBillExpenseLine } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Adds an expense line to a draft direct bill; the bill is recalculated.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await addDirectBillExpenseLine(client, context, id, input) }), 201, "procurement.bills.view");
}
