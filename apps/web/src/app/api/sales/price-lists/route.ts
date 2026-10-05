import { createPriceList, listPriceLists } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { priceListRead, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

// ?search&status&currencyCode
export async function GET(request: Request) {
  const url = new URL(request.url);
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, (client, context) => listPriceLists(client, context, {
    search: url.searchParams.get("search") ?? undefined, status: url.searchParams.get("status") ?? undefined, currencyCode: url.searchParams.get("currencyCode") ?? undefined,
  }));
}

export async function POST(request: Request) {
  return priceListWrite(request, SALES_PERMISSIONS.priceListsCreate, async (client, context, body) => ({ priceList: await createPriceList(client, context, body) }), 201);
}
