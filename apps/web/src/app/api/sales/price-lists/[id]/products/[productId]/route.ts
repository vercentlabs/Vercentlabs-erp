import { getProductPriceHistory } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { priceListRead } from "@/features/sales/price-lists/server/price-list-http";

type Params = { params: Promise<{ id: string; productId: string }> };

// Every price this product has had on the list.
export async function GET(request: Request, { params }: Params) {
  const { id, productId } = await params;
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, async (client, context) => ({ entries: await getProductPriceHistory(client, context, id, productId) }));
}
