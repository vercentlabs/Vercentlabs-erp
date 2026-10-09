import { getReorderOptions } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getReorderOptions(client, context) }), STOCK_REORDER_PERMISSIONS.view);
}
