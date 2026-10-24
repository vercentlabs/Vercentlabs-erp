import { supplierPageActivity } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What the supplier did on their page for this order: views, a proposed date, the invoices they sent.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ activity: await supplierPageActivity(client, context, id) }));
}
