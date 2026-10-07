import { getCategoryReport } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

type Params = { params: Promise<{ report: string }> };

// ?from=&to= for the dated reports. Each report checks its own permission (stock, cost).
export async function GET(request: Request, { params }: Params) {
  const { report } = await params;
  const url = new URL(request.url);
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({
    report: await getCategoryReport(client, context, report, { from: url.searchParams.get("from"), to: url.searchParams.get("to") }),
  }));
}
