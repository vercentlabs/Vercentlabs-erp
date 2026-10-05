import { copyPriceList } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

// body: { code, name, description?, validFrom?, validTo? }
export async function POST(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsCreate, async (client, context, body) => ({ priceList: await copyPriceList(client, context, id, body) }), 201);
}
