import { getStockBalanceOptions } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Views, the warehouses and locations the user may see, categories and capabilities.
export async function GET(request: Request) {
  return inventoryRead(request, (client, context) => getStockBalanceOptions(client, context));
}
