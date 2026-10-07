import { previewNextSku } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

// ?categoryId= — the SKU a new item would most likely get. Nothing is reserved: the number is taken when the item is saved.
export async function GET(request: Request) {
  const categoryId = new URL(request.url).searchParams.get("categoryId");
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ preview: await previewNextSku(client, context, { categoryId }) }));
}
