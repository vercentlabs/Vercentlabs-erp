import { requestPaymentReschedule } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Requests a revised due date for one open instalment of a posted bill; Finance approves it. Body: { scheduleId, newDueDate, reason }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await requestPaymentReschedule(client, context, id, input) }), 201, "procurement.view");
}
