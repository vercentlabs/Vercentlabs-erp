import { getInventoryOverview } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Inventory Overview: stock summary, what needs attention, today's operations, recent activity and the quick actions the user may take.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ overview: await getInventoryOverview(client, context) }));
}
