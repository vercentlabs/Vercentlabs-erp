import { z } from "zod";

import { createInvoiceRequest } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ idempotencyKey: z.string().trim().min(1).max(200), quantityBasis: z.enum(["ordered", "fulfilled"]).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.request", schema, async (client, context, input) => ({ request: await createInvoiceRequest(client, context, id, input) }), 201);
}
