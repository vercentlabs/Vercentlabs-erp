import { getLowStockAlerts } from "@vercentlabs/api";
import { STOCK_ALERT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

import { ALERT_FILTER_KEYS } from "./filters";

// Low-stock alerts of the warehouses you can see: ?view= (active | critical | out_of_stock | replenishment_required | low_stock | overdue |
// unacknowledged | resolved | all) and the filters above. Urgency first.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(ALERT_FILTER_KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => getLowStockAlerts(client, context, filters), STOCK_ALERT_PERMISSIONS.view);
}
