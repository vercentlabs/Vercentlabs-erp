import { getInventoryReportCatalog } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// The Inventory reports this user may run.
export async function GET(request: Request) {
  return inventoryRead(request, async (_client, context) => ({ reports: getInventoryReportCatalog(context) }));
}
