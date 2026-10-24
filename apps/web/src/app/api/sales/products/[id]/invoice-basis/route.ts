import { z } from "zod";

import { setProductInvoiceBasis } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// How the product is billed: { basis: ordered | delivered | null (the company's setting) }.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ basis: z.enum(["ordered", "delivered"]).nullable() }), async (client, context, input) =>
    setProductInvoiceBasis(client, context, id, input.basis));
}
