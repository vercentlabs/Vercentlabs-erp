import { z } from "zod";

import { createDebitNote, getDebitNoteProposal } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// What a debit note on this invoice can add to (GET), and raising it (POST) (Sales plan). Whoever raises credit notes raises debit notes.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.invoice.view", async (client, context) => ({ proposal: await getDebitNoteProposal(client, context, id) }));
}

const schema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  reasonCode: z.enum(["rate_difference", "undercharge", "additional_charge", "tax_correction", "other"]),
  reasonNote: z.string().max(1000).optional(),
  debitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(z.object({ invoiceLineId: z.string().uuid(), amount: z.number().min(0) })).min(1).max(500),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.view", schema, async (client, context, input) => ({ result: await createDebitNote(client, context, id, input) }), 201);
}
