import { getSupplierAdvances } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The advances a supplier has paid and not yet used (?supplierId=&purchaseOrderId=), shown on bill entry.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) =>
    getSupplierAdvances(client, context, { supplierId: url.searchParams.get("supplierId"), purchaseOrderId: url.searchParams.get("purchaseOrderId") }), "procurement.bills.view");
}
