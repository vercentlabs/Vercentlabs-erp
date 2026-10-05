import { z } from "zod";

import { postSalesInvoice } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Posts the invoice: checked again, then made the customer's receivable and entered in the books. Posting twice posts once.
const schema = z.object({ expectedVersion: z.number().int().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.post", schema, async (client, context, input) => ({ result: await postSalesInvoice(client, context, id, input) }));
}
