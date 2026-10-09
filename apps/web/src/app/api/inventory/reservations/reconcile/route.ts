import { reconcileInventoryReservations } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Reserved against the reservations, reservation totals, serials held twice, positions reserved beyond their stock, closed sources. Changes nothing.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ report: await reconcileInventoryReservations(client, context) }), STOCK_RESERVATION_PERMISSIONS.reconcile);
}
