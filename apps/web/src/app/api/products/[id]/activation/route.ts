import { validateItemForActivation } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead } from "@/features/items/server/item-http";

// What stands between the item and Active.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, (client, context) => validateItemForActivation(client, context, id));
}
