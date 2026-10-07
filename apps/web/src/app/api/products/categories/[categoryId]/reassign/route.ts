import { reassignCategoryItems } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ categoryId: string }> };

// body: { targetCategoryId } — moves every item of the category, each through the item rules.
export async function POST(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageCategories, (client, context, body) => reassignCategoryItems(client, context, categoryId, body));
}
