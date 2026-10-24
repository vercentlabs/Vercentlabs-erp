import { z } from "zod";

import { applySalesCreditNote, getCreditNoteApplication } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// A final credit note's leftover, used on the customer's other open invoices from Sales (Sales report H7): GET what is left and where it
// can go; POST the amounts (none: the oldest due invoices first). Finalising credit notes or recording payments allows it.
const schema = z.object({ allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.number().positive() })).max(200).optional() });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => ({ application: await getCreditNoteApplication(client, context, id) }));
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ result: await applySalesCreditNote(client, context, id, input) }));
}
