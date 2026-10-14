import {
  cancelFinishedGoodsReceipt, checkFinishedGoodsReceiptPosting, decideFinishedGoodsReceiptApproval, decideFinishedGoodsReceiptCorrection, getFinishedGoodsReceipt, postFinishedGoodsReceipt,
  previewFinishedGoodsReceipt, recordFinishedGoodsReceiptPrint, recoverFinishedGoodsReceipt, requestFinishedGoodsReceiptApproval, requestFinishedGoodsReceiptCorrection,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { receiptActionSchema } from "@/features/manufacturing/receipts/api/fgr-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET preview (what posting would do now; moves nothing) · posting-status (the receipt against Inventory and Finance) · document (the note to print).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "preview": return { preview: await previewFinishedGoodsReceipt(client, context, id) };
      case "posting-status": return { posting: await checkFinishedGoodsReceiptPosting(client, context, id) };
      case "document": return { receipt: await getFinishedGoodsReceipt(client, context, id) };
      default: throw new HttpError(404, "Unknown finished-goods receipt view.", "NOT_FOUND");
    }
  });
}

// post · cancel · request-approval · decide-approval · request-correction · decide-correction · print (counts a copy; posts nothing) · recover.
// Each checks its own permission in the domain; a retried post finds the posted receipt.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, receiptActionSchema, async (client, context, input) => {
    switch (action) {
      case "post": return await postFinishedGoodsReceipt(client, context, id, input);
      case "cancel": return { receipt: await cancelFinishedGoodsReceipt(client, context, id, input) };
      case "request-approval": return { receipt: await requestFinishedGoodsReceiptApproval(client, context, id, input) };
      case "decide-approval": return { receipt: await decideFinishedGoodsReceiptApproval(client, context, id, input) };
      case "request-correction": return { receipt: await requestFinishedGoodsReceiptCorrection(client, context, id, input) };
      case "decide-correction": return { receipt: await decideFinishedGoodsReceiptCorrection(client, context, id, input) };
      case "print": return { receipt: await recordFinishedGoodsReceiptPrint(client, context, id) };
      case "recover": return await recoverFinishedGoodsReceipt(client, context, id);
      default: throw new HttpError(404, "Unknown finished-goods receipt action.", "NOT_FOUND");
    }
  });
}
