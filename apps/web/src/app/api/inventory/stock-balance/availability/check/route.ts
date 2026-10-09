import { validateAvailableStock } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Can this quantity (in this unit, converted to base first) be committed now from this warehouse? Advice only: transactions reserve atomically.
// ?itemId=&warehouseId=&quantity=&uomId=&locationId=&batchId=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) || null;
  return inventoryRead(request, async (client, context) => ({
    check: await validateAvailableStock(client, context, { itemId: get("itemId") ?? "", warehouseId: get("warehouseId") ?? "", quantity: get("quantity") ?? "", uomId: get("uomId"),
      locationId: get("locationId"), batchId: get("batchId") }),
  }));
}
