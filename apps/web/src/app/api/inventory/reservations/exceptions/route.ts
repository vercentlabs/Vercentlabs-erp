import { getReservationExceptions } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Reservations needing attention: ineligible stock, a missing serial, an inactive warehouse, a closed source, more than the source needs, less stock
// than is reserved, a Reserved figure that differs.
export async function GET(request: Request) {
  return inventoryRead(request, (client, context) => getReservationExceptions(client, context), STOCK_RESERVATION_PERMISSIONS.resolveExceptions);
}
