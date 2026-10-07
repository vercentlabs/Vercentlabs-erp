import { getProcurementReportCatalog } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The Procurement reports the caller may open.
export async function GET(request: Request) {
  return procurementRead(request, async (_client, context) => ({ reports: getProcurementReportCatalog(context) }), "procurement.view");
}
