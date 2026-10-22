import { getCustomerOpenItems } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What the customer owes bill by bill (oldest due first), its advances and unused credit notes: the New Payment form allocates against it.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => getCustomerOpenItems(client, context, id));
}
