import { setItemPurchaseWarning } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// An item's purchase warning: { level: none | warn | block, message? }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await setItemPurchaseWarning(client, context, id, input as { level?: string; message?: string }) }));
}
