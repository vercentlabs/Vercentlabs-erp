import { updateUnitOfMeasure } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ uomId: string }> };

// body: { name?, category?, decimalPlaces? }
export async function PATCH(request: Request, { params }: Params) {
  const { uomId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageUomMaster, async (client, context, body) => ({ unit: await updateUnitOfMeasure(client, context, uomId, body) }));
}
