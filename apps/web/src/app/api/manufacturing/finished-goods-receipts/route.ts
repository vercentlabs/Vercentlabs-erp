import { createFinishedGoodsReceiptDraft, listFinishedGoodsReceipts } from "@vercentlabs/api";

import { receiptDraftSchema } from "@/features/manufacturing/receipts/api/fgr-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Finished-goods receipt notes (?status=&correction=&orderId=&warehouseId=&itemId=&receivedBy=&from=&to=&search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "correction", "orderId", "warehouseId", "itemId", "receivedBy", "from", "to", "search"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ receipts: await listFinishedGoodsReceipts(client, context, filters) }));
}

// A draft receipt (nothing moves); the same idempotency key returns the draft it created.
export async function POST(request: Request) {
  return manufacturingMutation(request, receiptDraftSchema, async (client, context, input) => ({ receipt: await createFinishedGoodsReceiptDraft(client, context, input) }), 201);
}
