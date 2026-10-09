import { validateStockHold } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// What placing the hold would do against stock as it is now, and the reservations it would release or reallocate.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ validation: await validateStockHold(client, context, id) }), STOCK_HOLD_PERMISSIONS.view);
}
