import { listValuationEvents } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Valuation operations: reconciliations run, rebuilds, backdated restatements.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ events: await listValuationEvents(client, context) }), STOCK_VALUATION_PERMISSIONS.reconcileView);
}
