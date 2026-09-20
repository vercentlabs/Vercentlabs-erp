import { getProcurementDashboard } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

export async function GET() {
  return procurementRead(async (client, context) => ({ dashboard: await getProcurementDashboard(client, context) }));
}
