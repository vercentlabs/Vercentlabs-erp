import { getItemInventorySummary } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead } from "@/features/items/server/item-http";

// On hand, reserved, available, incoming and outgoing, by warehouse — read from Inventory, never edited here.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.viewStock, async (client, context) => ({ inventory: await getItemInventorySummary(client, context, id) }));
}
