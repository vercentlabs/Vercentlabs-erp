import { getSalesDashboard } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET() {
  return salesRead("sales.view", async (client, context) => ({ dashboard: await getSalesDashboard(client, context) }));
}
