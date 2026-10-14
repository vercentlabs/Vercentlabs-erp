import { getMoFinishedGoodsReceiptHistory } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's finished-goods receipts (its receipt history). The order's own "Receive goods" posts a receipt note through the same path as
// /api/manufacturing/finished-goods-receipts/{id}/post.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ receipts: await getMoFinishedGoodsReceiptHistory(client, context, id) }));
}
