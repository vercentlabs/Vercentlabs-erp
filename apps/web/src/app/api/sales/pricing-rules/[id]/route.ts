import { getPricingRule, updatePricingRule } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListRead, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

export async function GET(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, async (client, context) => ({ rule: await getPricingRule(client, context, id) }));
}

export async function PATCH(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsManagePrices, async (client, context, body) => ({ rule: await updatePricingRule(client, context, id, body) }));
}
