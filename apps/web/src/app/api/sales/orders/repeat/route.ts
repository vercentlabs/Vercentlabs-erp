import { z } from "zod";

import { repeatSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Repeat order (Sales audit): a new draft order from a past order or invoice, priced today.
const schema = z.object({ orderId: z.string().uuid().optional(), invoiceId: z.string().uuid().optional(), idempotencyKey: z.string().max(150).optional() })
  .refine((input) => Boolean(input.orderId || input.invoiceId), "Choose the order or invoice to repeat.");

export async function POST(request: Request) {
  return salesMutation(request, "sales.order.create", schema, async (client, context, input) => ({ result: await repeatSalesOrder(client, context, input) }));
}
