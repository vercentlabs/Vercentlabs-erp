import { getCategoryStockSummary } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

type Params = { params: Promise<{ categoryId: string }> };

// Stock of the category's items by warehouse, read from Inventory; ?includeSubcategories=no for its own items only.
export async function GET(request: Request, { params }: Params) {
  const { categoryId } = await params;
  const url = new URL(request.url);
  return productRead(request, PRODUCT_PERMISSIONS.viewStock, (client, context) =>
    getCategoryStockSummary(client, context, categoryId, { includeDescendants: url.searchParams.get("includeSubcategories") !== "no" }));
}
