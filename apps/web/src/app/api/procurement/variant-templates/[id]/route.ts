import { getPurchaseVariantGrid } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// One item's variants laid out as a grid (sizes down, colours across).
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ grid: await getPurchaseVariantGrid(client, context, id) }));
}
