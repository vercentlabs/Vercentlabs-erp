import { getWarehouseOptions } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Types, location purposes, members, GST registrations, defaults and the caller's preferred warehouse.
export async function GET(request: Request) {
  return inventoryRead(request, (client, context) => getWarehouseOptions(client, context), WAREHOUSE_PERMISSIONS.view);
}
