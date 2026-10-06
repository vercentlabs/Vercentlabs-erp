import { z } from "zod";

import { changePostedInvoiceDueDate } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Corrects a posted invoice's due date: by permission, with a reason, kept in its history.
const schema = z.object({ dueDate: z.string().date(), reason: z.string().trim().min(1).max(500) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.change_posted_due_date", schema, async (client, context, input) => ({ result: await changePostedInvoiceDueDate(client, context, id, input) }));
}
