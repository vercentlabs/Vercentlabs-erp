import { z } from "zod";

import { createPosReturn, listPosReturns } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// GET ?search=&status=&refundStatus=&saleId=&dateFrom=&dateTo=&limit=&offset=: return history at the outlets you work at — by return,
// receipt, invoice or credit-note number; the return's status and its refund status kept apart.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const value = (key: string) => search.get(key) || undefined;
  return posRead(request, async (client, context) => listPosReturns(client, context, {
    search: value("search"), status: value("status"), refundStatus: value("refundStatus"), saleId: value("saleId"), dateFrom: value("dateFrom"), dateTo: value("dateTo"),
    limit: search.get("limit") ? Number(search.get("limit")) : undefined, offset: search.get("offset") ? Number(search.get("offset")) : undefined,
  }), "pos.view");
}

// POST: start a return (a draft) against a completed sale — per line the quantity in the unit sold, a reason and the goods' condition. Its
// quantities are held at once; the original price, discounts and tax come from the sale. No money moves until it is posted.
const lineSchema = z.object({
  saleLineId: z.string().uuid(),
  quantity: z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()]).transform((value) => String(value)),
  reasonCode: z.enum(["damaged_product", "defective_product", "wrong_item", "wrong_size_variant", "customer_changed_mind", "quality_issue", "not_as_described", "other"]).optional(),
  reasonNote: z.string().trim().max(300).optional(),
  conditionCode: z.enum(["unopened", "good", "opened", "damaged", "defective"]).optional(),
  dispositionCode: z.enum(["return_hold", "restock_approved", "damaged", "quarantined", "rejected_not_received"]).optional(),
  serialId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
});
const schema = z.object({
  saleId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  receiptPresent: z.boolean().optional(),
  lines: z.array(lineSchema).min(1).max(200),
  reasonSummary: z.string().trim().max(300).optional(),
  overrideReason: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await createPosReturn(client, context, input) }), 201, "pos.view");
}
