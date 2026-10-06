import { validateCreditNoteForPosting } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What stops the credit note being posted now (quantities and value left on the invoice, period, …).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.credit_note.view", async (client, context) => ({ check: await validateCreditNoteForPosting(client, context, id) }));
}
