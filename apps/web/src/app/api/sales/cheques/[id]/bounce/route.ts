import { z } from "zod";

import { bounceCheque } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The bank returned the cheque: its receipt is reversed; a bounce charge can go on a draft debit note.
const schema = z.object({ reason: z.string().trim().min(3).max(500), bouncedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), charge: z.number().positive().nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ result: await bounceCheque(client, context, id, input) }));
}
