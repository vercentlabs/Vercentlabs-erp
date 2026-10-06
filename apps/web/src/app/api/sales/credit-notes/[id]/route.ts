import { z } from "zod";

import { getCreditNote, updateDraftCreditNote } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.credit_note.view", async (client, context) => ({ creditNote: await getCreditNote(client, context, id) }));
}

// A draft's lines (the full set), date, reason and notes.
const schema = z.object({
  expectedVersion: z.number().int().optional(),
  lines: z.array(z.object({
    invoiceLineId: z.string().uuid(), creditType: z.enum(["quantity", "amount"]), quantity: z.union([z.number(), z.string()]).nullable().optional(),
    amount: z.union([z.number(), z.string()]).nullable().optional(),
  })).max(500).optional(),
  reasonCode: z.string().max(40).optional(),
  reasonNote: z.string().max(1000).nullable().optional(),
  creditDate: z.string().date().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.credit_note.edit", schema, async (client, context, input) => ({ result: await updateDraftCreditNote(client, context, id, input) }));
}
