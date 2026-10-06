import { z } from "zod";

import { createCreditNote, getCreditNoteProposal } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What the invoice can still be credited for, line by line.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.credit_note.view", async (client, context) => ({ proposal: await getCreditNoteProposal(client, context, id) }));
}

// A draft credit note against the posted invoice: quantities, or amounts (a stronger permission).
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  reasonCode: z.string().max(40),
  reasonNote: z.string().max(1000).nullable().optional(),
  creditDate: z.string().date().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
  lines: z.array(z.object({
    invoiceLineId: z.string().uuid(), creditType: z.enum(["quantity", "amount"]), quantity: z.union([z.number(), z.string()]).nullable().optional(),
    amount: z.union([z.number(), z.string()]).nullable().optional(),
  })).min(1).max(500),
});

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.credit_note.create", schema, async (client, context, input) => ({ result: await createCreditNote(client, context, id, input) }), 201);
}
