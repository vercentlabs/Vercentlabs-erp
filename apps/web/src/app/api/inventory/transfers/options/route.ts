import { getInventoryTransferOptions } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Warehouses with their locations (and dispositions), the transfer reasons and statuses, and what the user may do.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getInventoryTransferOptions(client, context) }), STOCK_TRANSFER_PERMISSIONS.view);
}
