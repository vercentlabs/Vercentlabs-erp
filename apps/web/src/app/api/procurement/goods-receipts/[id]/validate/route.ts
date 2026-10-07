import { validateGoodsReceiptForPosting } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What posting would check, without posting: the preview before Post Receipt.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ validation: await validateGoodsReceiptForPosting(client, context, id) }), "procurement.po.view");
}
