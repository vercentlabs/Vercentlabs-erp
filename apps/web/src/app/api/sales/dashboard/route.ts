import { getSalesDashboard } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => ({ dashboard: await getSalesDashboard(client, context) }));
}
