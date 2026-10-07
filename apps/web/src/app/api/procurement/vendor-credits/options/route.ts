import { getVendorCreditOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What the credit and claim forms choose from; with ?supplierId= the supplier's creditable bills, returns and accepted claims.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { supplierId: url.searchParams.get("supplierId") ?? undefined, excludeCreditId: url.searchParams.get("excludeCreditId") ?? undefined };
  return procurementRead(request, async (client, context) => getVendorCreditOptions(client, context, filters), "procurement.view");
}
