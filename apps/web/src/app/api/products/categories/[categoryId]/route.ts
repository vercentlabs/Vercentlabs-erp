import { deleteItemCategory, getItemCategory, updateItemCategory } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead, productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ categoryId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ category: await getItemCategory(client, context, categoryId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageCategories, async (client, context, body) => ({ category: await updateItemCategory(client, context, categoryId, body) }));
}

// Only a category nothing refers to; body: { reason? }. The deletion is recorded.
export async function DELETE(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.deleteCategories, (client, context, body) => deleteItemCategory(client, context, categoryId, body));
}
