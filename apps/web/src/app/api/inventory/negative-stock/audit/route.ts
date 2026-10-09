import { listNegativeStockAudit } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Every override, blocked attempt, negative position change and policy change: ?eventType=, ?itemId=, ?warehouseId=, ?exceptionId=, ?userId=, ?from=, ?to=, ?limit=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["eventType", "itemId", "warehouseId", "exceptionId", "userId", "from", "to", "limit"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listNegativeStockAudit(client, context, filters), NEGATIVE_STOCK_PERMISSIONS.viewAudit);
}
