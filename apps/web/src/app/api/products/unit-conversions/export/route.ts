import { exportItemUomConversions } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, productRead } from "@/features/items/server/item-http";

// Every item's units as CSV: SKU, item, base unit, unit, conversion to base, usage and status.
export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.export, async (client, context) => {
    const exported = await exportItemUomConversions(client, context);
    return csvResponse(exported.csv, exported.fileName);
  });
}
