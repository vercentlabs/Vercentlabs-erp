import { getItemBatches } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead } from "@/features/items/server/item-http";

export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.viewStock, async (client, context) => ({ batches: await getItemBatches(client, context, id) }));
}
