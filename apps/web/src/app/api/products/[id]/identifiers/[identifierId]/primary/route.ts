import { setPrimaryBarcode } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ id: string; identifierId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, identifierId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageIdentifiers, (client, context) => setPrimaryBarcode(client, context, id, identifierId));
}
