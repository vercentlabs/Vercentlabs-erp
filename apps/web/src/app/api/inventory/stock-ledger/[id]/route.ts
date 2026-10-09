import { getMovementDetail } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One movement: its posting, document, reversal links, valuation and journals.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getMovementDetail(client, context, id) }), STOCK_LEDGER_PERMISSIONS.view);
}
