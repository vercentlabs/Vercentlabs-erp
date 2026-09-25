import { z } from "zod";

import { createInvoiceRequest } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F051: optional lines/quantities to bill now (a partial invoice).
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  quantityBasis: z.enum(["ordered", "fulfilled"]).optional(),
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).max(500).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.request", schema, async (client, context, input) => ({ request: await createInvoiceRequest(client, context, id, input) }), 201);
}
