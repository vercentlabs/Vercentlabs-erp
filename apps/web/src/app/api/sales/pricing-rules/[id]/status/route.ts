import { setPricingRuleStatus } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

// { action: "activate" | "deactivate" | "delete" }
export async function POST(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsManagePrices, async (client, context, body) => ({
    result: await setPricingRuleStatus(client, context, id, String(body.action ?? "") as "activate" | "deactivate" | "delete"),
  }));
}
