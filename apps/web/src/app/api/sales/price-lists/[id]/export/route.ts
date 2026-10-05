import { exportPrices } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type PriceListRouteParams, csvResponse, priceListRead } from "@/features/sales/price-lists/server/price-list-http";

// ?state=active|current|all
export async function GET(request: Request, { params }: PriceListRouteParams) {
  const { id } = await params;
  const state = new URL(request.url).searchParams.get("state") ?? "active";
  return priceListRead(request, SALES_PERMISSIONS.priceListsExport, async (client, context) => {
    const exported = await exportPrices(client, context, id, { state });
    return csvResponse(exported.csv, exported.fileName);
  });
}
