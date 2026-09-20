import { z } from "zod";

import { requestSalesCreditAdjustment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  salesOrderId: z.string().uuid(),
  adjustmentType: z.enum(["credit_note", "refund"]),
  amount: z.union([z.number(), z.string()]),
  reason: z.string().trim().min(1).max(2000),
  returnRequestId: z.string().uuid().nullish(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.invoice.request", schema, async (client, context, input) => ({ adjustment: await requestSalesCreditAdjustment(client, context, input) }), 201);
}
