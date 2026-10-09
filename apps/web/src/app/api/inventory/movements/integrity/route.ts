import { checkMovementHistoryIntegrity } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Is every posted movement explainable (a posting with a source document, internal postings netting to zero, no duplicates)?
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ integrity: await checkMovementHistoryIntegrity(client, context) }), STOCK_LEDGER_PERMISSIONS.reconcile);
}
