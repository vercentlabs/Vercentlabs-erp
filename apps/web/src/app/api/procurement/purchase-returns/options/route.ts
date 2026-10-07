import { getPurchaseReturnOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Reasons, expected resolutions, views and what the caller may do.
export async function GET(request: Request) {
  return procurementRead(request, async (_client, context) => ({ options: getPurchaseReturnOptions(context) }), "procurement.returns.view");
}
