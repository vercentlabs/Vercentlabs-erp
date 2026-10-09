import { getNegativeStockException } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One negative position: the exception, every override behind it and its history.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getNegativeStockException(client, context, id) }), NEGATIVE_STOCK_PERMISSIONS.viewExceptions);
}
