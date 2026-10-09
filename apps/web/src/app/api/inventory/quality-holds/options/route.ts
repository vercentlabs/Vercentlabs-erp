import { getHoldOptions } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Hold types, reasons, warehouses with their locations, reviewers and what the user may do.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getHoldOptions(client, context) }), STOCK_HOLD_PERMISSIONS.view);
}
