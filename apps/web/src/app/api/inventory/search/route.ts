import { searchInventory } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Inventory search (?q=): items, warehouses, locations, batches, serials and stock documents, each with the page that owns it.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return inventoryRead(request, async (client, context) => searchInventory(client, context, q));
}
