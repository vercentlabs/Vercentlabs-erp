import { activatePriceList, deactivatePriceList, setDefaultPriceList } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { type PriceListRouteParams, priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

// body: { action: activate | deactivate | make_default, reason? }. Each
// operation checks the permission for what it does.
export async function POST(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsView, async (client, context, body) => {
    if (body.action === "make_default") return { priceList: await setDefaultPriceList(client, context, id) };
    if (body.action === "activate") return { priceList: await activatePriceList(client, context, id, { reason: body.reason }) };
    if (body.action === "deactivate") return { priceList: await deactivatePriceList(client, context, id, { reason: body.reason }) };
    throw new HttpError(400, "Unknown status action.");
  });
}
