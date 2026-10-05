import { getPriceList, listPriceListHistory } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListRead } from "@/features/sales/price-lists/server/price-list-http";

export async function GET(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, async (client, context) => {
    const list = await getPriceList(client, context, id);
    return { history: await listPriceListHistory(client, context, list.id) };
  });
}
