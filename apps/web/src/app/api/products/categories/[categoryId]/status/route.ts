import { setItemCategoryStatus } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ categoryId: string }> };

// body: { status: active | inactive, reason? }
export async function POST(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.manageCategories, async (client, context, body) =>
    ({ category: await setItemCategoryStatus(client, context, categoryId, String(body.status ?? ""), { reason: body.reason }) }));
}
