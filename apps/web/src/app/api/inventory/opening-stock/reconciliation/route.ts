import { getOpeningStockReconciliation } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Opening Inventory value against Finance's opening Inventory balance.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ reconciliation: await getOpeningStockReconciliation(client, context) }), OPENING_STOCK_PERMISSIONS.reconcile);
}
