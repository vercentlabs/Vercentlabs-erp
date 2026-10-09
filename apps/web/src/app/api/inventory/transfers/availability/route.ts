import { getTransferAvailability } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// An item's stock at the source warehouse for the line editor: positions with on hand, reserved, available and disposition; batches; serials in stock.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = { warehouseId: url.searchParams.get("warehouseId") ?? "", itemId: url.searchParams.get("itemId") ?? "" };
  return inventoryRead(request, async (client, context) => ({ availability: await getTransferAvailability(client, context, input) }), STOCK_TRANSFER_PERMISSIONS.view);
}
