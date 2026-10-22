import { getPurchaseOrderOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Views, labels, reasons and master data for the purchase order screens. Suppliers and products are a first page plus the ones a form
// holds (?supplierIds=&productIds=; supplierId ranks each product's last price from that supplier first).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return procurementRead(request, async (client, context) => ({
    options: await getPurchaseOrderOptions(client, context, {
      supplierIds: params.get("supplierIds") ?? "", productIds: params.get("productIds") ?? "", supplierId: params.get("supplierId"),
    }),
  }), "procurement.po.view");
}
