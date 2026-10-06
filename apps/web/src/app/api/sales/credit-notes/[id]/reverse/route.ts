import { z } from "zod";

import { reverseCreditNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Reverses a posted credit note: unapplied from the invoices it was applied to, the books and output tax restored.
const schema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.credit_note.reverse", schema, async (client, context, input) => ({ result: await reverseCreditNote(client, context, id, input) }));
}
