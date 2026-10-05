import { z } from "zod";

import { createCreditNoteFromInvoice } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A draft credit note against the invoice, for Finance to post.
const schema = z.object({ idempotencyKey: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(1000), lines: z.array(z.object({ invoiceLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).min(1).max(500) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.credit_note", schema, async (client, context, input) => ({ result: await createCreditNoteFromInvoice(client, context, id, input) }));
}
