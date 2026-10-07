import { getCategoryItems } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

type Params = { params: Promise<{ categoryId: string }> };

// ?includeSubcategories=yes adds the items of every sub-category.
export async function GET(request: Request, { params }: Params) {
  const { categoryId } = await params;
  const url = new URL(request.url);
  return productRead(request, PRODUCT_PERMISSIONS.view, (client, context) =>
    getCategoryItems(client, context, categoryId, {
      includeDescendants: url.searchParams.get("includeSubcategories") === "yes",
      limit: Number(url.searchParams.get("limit") ?? 200),
      offset: Number(url.searchParams.get("offset") ?? 0),
    }));
}
