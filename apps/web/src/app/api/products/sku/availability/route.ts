import { checkSkuAvailability } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

// ?sku=&excludeId= — whether the SKU is valid and free (not another item's, now or before).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({
    check: await checkSkuAvailability(client, context, url.searchParams.get("sku") ?? "", { exceptItemId: url.searchParams.get("excludeId") }),
  }));
}
