import { createItemVariant, getItemVariants } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead, productWrite } from "@/features/items/server/item-http";

export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, (client, context) => getItemVariants(client, context, id));
}

// body: { attributes, code?, name?, barcode?, type?, trackingType?, status? }
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.create, async (client, context, body) => ({ product: await createItemVariant(client, context, id, body) }), 201);
}
