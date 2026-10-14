import { getFinishedGoodsReceipt, updateFinishedGoodsReceiptDraft } from "@vercentlabs/api";

import { receiptEditSchema } from "@/features/manufacturing/receipts/api/fgr-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One finished-goods receipt: lines, lots and serial units, approval, posting, corrections and timeline.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ receipt: await getFinishedGoodsReceipt(client, context, id) }));
}

// Edit an unposted receipt under its version (an edit withdraws an approval).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, receiptEditSchema, async (client, context, input) => ({ receipt: await updateFinishedGoodsReceiptDraft(client, context, id, input) }));
}
