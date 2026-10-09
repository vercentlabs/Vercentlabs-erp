import { getLowStockAlert } from "@vercentlabs/api";
import { STOCK_ALERT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One alert: live figures (recalculated now), what was detected, demand, incoming, other warehouses, history and earlier occurrences.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getLowStockAlert(client, context, id) }), STOCK_ALERT_PERMISSIONS.view);
}
