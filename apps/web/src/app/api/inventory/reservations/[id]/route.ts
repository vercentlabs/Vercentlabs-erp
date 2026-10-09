import { getInventoryReservation } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// One reservation: requested, reserved, consumed, released and active; its allocations with their history; its exceptions.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ detail: await getInventoryReservation(client, context, id) }), STOCK_RESERVATION_PERMISSIONS.view);
}
