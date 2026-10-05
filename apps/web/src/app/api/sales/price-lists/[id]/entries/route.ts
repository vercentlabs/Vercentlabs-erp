import { addPrice, listPriceListEntries } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListRead, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

// ?search&state=current|future|expired|inactive|all&limit&offset
export async function GET(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  const url = new URL(request.url);
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, (client, context) => listPriceListEntries(client, context, id, {
    search: url.searchParams.get("search") ?? undefined, state: url.searchParams.get("state") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 100), offset: Number(url.searchParams.get("offset") ?? 0),
  }));
}

// body: { productId, uomId?, unitPrice, validFrom?, validTo? }
export async function POST(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsManagePrices, async (client, context, body) => ({ entry: await addPrice(client, context, id, body) }), 201);
}
