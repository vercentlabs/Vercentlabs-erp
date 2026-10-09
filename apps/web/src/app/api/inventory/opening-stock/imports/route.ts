import { listOpeningStockImports } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Migration batches: every file checked or imported, with its row counts.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ imports: await listOpeningStockImports(client, context) }), OPENING_STOCK_PERMISSIONS.view);
}
