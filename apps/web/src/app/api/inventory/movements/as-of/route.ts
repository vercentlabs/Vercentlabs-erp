import { getMovementHistoryAsOf } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Stock of a position as of a moment or as of one movement (?movementId), by disposition, from the ledger.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  return inventoryRead(request, async (client, context) => ({
    asOf: await getMovementHistoryAsOf(client, context, { itemId: get("itemId"), warehouseId: get("warehouseId"), locationId: get("locationId"), batchId: get("batchId"),
      serialId: get("serialId"), at: get("at"), movementId: get("movementId") }),
  }), STOCK_LEDGER_PERMISSIONS.view);
}
