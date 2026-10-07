import { setItemDefaultUoms } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productWrite } from "@/features/items/server/item-http";

// body: { purchaseUomId?, salesUomId?, reason? } — each must be one of the item's units enabled for it.
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.changeDefaultUoms, async (client, context, body) => ({ units: await setItemDefaultUoms(client, context, id, body) }));
}
