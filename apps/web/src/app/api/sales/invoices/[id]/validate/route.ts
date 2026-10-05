import { validateInvoiceForPosting } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What stops the invoice being posted now (quantities, tax, period, …).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.invoice.view", async (client, context) => ({ check: await validateInvoiceForPosting(client, context, id) }));
}
