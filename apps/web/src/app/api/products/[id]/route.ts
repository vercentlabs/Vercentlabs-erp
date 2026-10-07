import { deleteProduct, getProduct, updateProduct } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead, productWrite } from "@/features/items/server/item-http";

export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ product: await getProduct(client, context, id) }));
}

export async function PATCH(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.edit, async (client, context, body) => ({ product: await updateProduct(client, context, id, body) }));
}

// Only a product that has never been used.
export async function DELETE(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.delete, (client, context) => deleteProduct(client, context, id));
}
