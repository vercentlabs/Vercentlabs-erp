import { getItemUomHistory } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead } from "@/features/items/server/item-http";

// What changed on the item's units: base, conversions, usage, precision and defaults, with old and new values.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ history: await getItemUomHistory(client, context, id) }));
}
