import { removeItemUomConversion, updateItemUomConversion } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ id: string; conversionId: string }> };

// body: { factor?, purchasingEnabled?, salesEnabled?, inventoryEnabled?, quantityPrecision?, reason?, expectedVersion?, acknowledgeHistory? }
export async function PATCH(request: Request, { params }: Params) {
  const { id, conversionId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageUnits, (client, context, body) => updateItemUomConversion(client, context, id, conversionId, body));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, conversionId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageUnits, (client, context, body) => removeItemUomConversion(client, context, id, conversionId, body));
}
