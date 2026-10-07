import { addItemUomConversion, listItemUomConversions } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead, productWrite } from "@/features/items/server/item-http";

export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ conversions: await listItemUomConversions(client, context, id) }));
}

// body: { uomId, factor, purchasingEnabled?, salesEnabled?, inventoryEnabled?, quantityPrecision?, reason? } — 1 uom = factor base units;
// a deactivated unit is brought back with these settings.
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageUnits, (client, context, body) => addItemUomConversion(client, context, id, body), 201);
}
