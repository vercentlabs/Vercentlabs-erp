import { getPurchaseOrderOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Views, labels, reasons and master data for the purchase order screens.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ options: await getPurchaseOrderOptions(client, context) }), "procurement.po.view");
}
