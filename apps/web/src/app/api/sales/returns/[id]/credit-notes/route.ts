import { z } from "zod";

import { createCreditNoteFromReturn } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Draft credit notes against the original invoices for what came back after it was invoiced (one per invoice). Never posted here.
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200), reason: z.string().max(800).optional(), internalNotes: z.string().max(4000).optional(),
  lines: z.array(z.object({ returnLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).max(500).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.return.credit_note", schema, async (client, context, input) => ({ result: await createCreditNoteFromReturn(client, context, id, input) }));
}
