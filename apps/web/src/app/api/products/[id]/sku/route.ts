import { changeItemSku, getSkuHistory } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead, productWrite, type ProductRouteParams } from "@/features/items/server/item-http";

// The SKUs the item had before, newest first.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.viewSkuHistory, async (client, context) => ({ history: await getSkuHistory(client, context, id) }));
}

// body: { sku, reason?, expectedVersion? } — a new SKU for the same item; its stock and documents do not change.
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.changeSku, async (client, context, body) => ({ product: await changeItemSku(client, context, id, body) }));
}
