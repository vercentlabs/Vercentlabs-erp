import { getItemUnits } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead } from "@/features/items/server/item-http";

// Every unit the item can be counted in: its base, its own conversions (with usage and precision) and standard units of its dimension.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ units: await getItemUnits(client, context, id) }));
}
