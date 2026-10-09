import { getMovementHistoryDetail } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One posting in full: its legs, document chain, related postings, reservation consumed, valuation and finance.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getMovementHistoryDetail(client, context, id) }), STOCK_LEDGER_PERMISSIONS.view);
}
