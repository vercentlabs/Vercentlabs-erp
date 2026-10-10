import { removeItemIdentifier, updateItemIdentifier } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ id: string; identifierId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id, identifierId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageIdentifiers, (client, context) => removeItemIdentifier(client, context, id, identifierId));
}

// body: { uomId?, format?, expectedVersion? } — what the barcode sells (a carton) or its format; the value itself never changes.
export async function PATCH(request: Request, { params }: Params) {
  const { id, identifierId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageIdentifiers, (client, context, body) => updateItemIdentifier(client, context, id, identifierId, body));
}
