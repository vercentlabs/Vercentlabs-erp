import { z } from "zod";

import { recordSalesAdvancePayment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  salesOrderId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  paymentReference: z.string().trim().min(1).max(200),
  receivedAt: z.string().datetime().nullish(),
  note: z.string().trim().max(2000).nullish(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.invoice.request", schema, async (client, context, input) => ({ advance: await recordSalesAdvancePayment(client, context, input) }), 201);
}
