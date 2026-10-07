import { getPurchaseReturnInventoryMovements } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Inventory's movements for the return.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ movements: await getPurchaseReturnInventoryMovements(client, context, id) }), "procurement.returns.view");
}
