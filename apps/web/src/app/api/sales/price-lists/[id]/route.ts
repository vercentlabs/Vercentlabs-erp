import { deletePriceList, getPriceList, updatePriceList } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListRead, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

export async function GET(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, async (client, context) => ({ priceList: await getPriceList(client, context, id) }));
}

export async function PATCH(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsEdit, async (client, context, body) => ({ priceList: await updatePriceList(client, context, id, body) }));
}

// Only a price list nothing refers to.
export async function DELETE(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsActivate, (client, context) => deletePriceList(client, context, id));
}
