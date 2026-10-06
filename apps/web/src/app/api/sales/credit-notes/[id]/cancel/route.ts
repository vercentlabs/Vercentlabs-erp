import { z } from "zod";

import { cancelDraftCreditNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Cancels a draft; its number is kept, cancelled.
const schema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.credit_note.edit", schema, async (client, context, input) => ({ result: await cancelDraftCreditNote(client, context, id, input) }));
}
