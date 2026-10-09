import { getInventoryAttentionBadges } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// The Inventory sidebar badges: counts that need action (replenishment, quality holds, counts in progress, negative stock).
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ badges: await getInventoryAttentionBadges(client, context) }));
}
