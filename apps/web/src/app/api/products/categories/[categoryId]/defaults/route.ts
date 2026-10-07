import { resolveCategoryDefaults } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

type Params = { params: Promise<{ categoryId: string }> };

// What a new item (or a new sub-category) under this category inherits, and from where.
export async function GET(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ defaults: await resolveCategoryDefaults(client, context, categoryId) }));
}
