import { getNegativeStockSummary } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// The in-app badge: how many negative positions are open (null without the warnings permission).
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ summary: await getNegativeStockSummary(client, context) }));
}
