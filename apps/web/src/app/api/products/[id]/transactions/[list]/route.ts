import { listProductTransactions } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/sales/products/server/product-http";

type Params = { params: Promise<{ id: string; list: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, list } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ rows: await listProductTransactions(client, context, id, list) }));
}
