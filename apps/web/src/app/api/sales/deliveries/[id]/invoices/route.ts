import { z } from "zod";

import { createInvoiceFromDelivery } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A Draft invoice for what this delivery delivered and is not yet invoiced; each invoice line names its delivery line.
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  lines: z.array(z.object({ deliveryLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).max(500).optional(),
  invoiceDate: z.string().date().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.request", schema, async (client, context, input) => ({ result: await createInvoiceFromDelivery(client, context, id, input) }), 201);
}
