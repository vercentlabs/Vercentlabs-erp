import { z } from "zod";

import { einvoiceAfterPost, postSalesInvoice } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Posts the invoice: checked again, then made the customer's receivable and entered in the books. Posting twice posts once. With
// "e-invoice on posting" switched on (Sales plan), the IRN follows; a GSP refusal is kept on the invoice and never undoes the posting.
const schema = z.object({ expectedVersion: z.number().int().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.post", schema, async (client, context, input) => {
    const result = await postSalesInvoice(client, context, id, input);
    const einvoice = result?.status === "posted" && !result.replayed ? await einvoiceAfterPost(client, context, id) : null;
    return { result: { ...result, einvoice } };
  });
}
