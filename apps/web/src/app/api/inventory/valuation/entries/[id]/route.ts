import { getValuationEntry } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One valuation: movement, source document, cost source, FIFO layers, exchange rate, journals, reversal and restatements.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getValuationEntry(client, context, id) }), STOCK_VALUATION_PERMISSIONS.viewMovements);
}
