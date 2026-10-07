import { getProcurementOverview } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Procurement Home: the figures and the documents that need someone to act, each counted from its own module (sections the caller may not see are left out).
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ overview: await getProcurementOverview(client, context) }), "procurement.view");
}
