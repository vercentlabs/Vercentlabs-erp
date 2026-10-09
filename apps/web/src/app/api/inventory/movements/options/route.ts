import { getMovementHistoryOptions } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getMovementHistoryOptions(client, context) }), STOCK_LEDGER_PERMISSIONS.view);
}
