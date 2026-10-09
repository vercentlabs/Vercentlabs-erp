import { validateInventoryTransfer } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Whether the transfer can go ahead against stock as it is now, with every reason it cannot.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ validation: await validateInventoryTransfer(client, context, id) }), STOCK_TRANSFER_PERMISSIONS.view);
}
