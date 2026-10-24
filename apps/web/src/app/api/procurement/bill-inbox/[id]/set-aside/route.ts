import { setAsideBillInboxEntry } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Not a bill: { reason }; or bring it back: { restore: true }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await setAsideBillInboxEntry(client, context, id, input as { reason?: string; restore?: boolean }) }),
    200, "procurement.bills.view");
}
