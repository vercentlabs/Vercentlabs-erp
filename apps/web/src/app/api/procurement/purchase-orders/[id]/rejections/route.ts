import { getPurchaseOrderRejections, recordDockRejection } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The order's rejection cases; recording goods refused at the dock, with or without a goods receipt.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ rows: await getPurchaseOrderRejections(client, context, id) }), "procurement.rejections.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordDockRejection(client, context, id, input) }), 201, "procurement.rejections.record");
}
