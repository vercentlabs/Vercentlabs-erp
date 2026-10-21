import { createPricingRule, listPricingRules } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { priceListRead, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

// Schemes and special rates (Sales audit M3). ?search&status&type&partyId&itemId
export async function GET(request: Request) {
  const url = new URL(request.url);
  const read = (key: string) => url.searchParams.get(key) ?? undefined;
  return priceListRead(request, SALES_PERMISSIONS.priceListsView, (client, context) => listPricingRules(client, context, {
    search: read("search"), status: read("status"), type: read("type"), partyId: read("partyId"), itemId: read("itemId"),
  }));
}

export async function POST(request: Request) {
  return priceListWrite(request, SALES_PERMISSIONS.priceListsManagePrices, async (client, context, body) => ({ rule: await createPricingRule(client, context, body) }), 201);
}
