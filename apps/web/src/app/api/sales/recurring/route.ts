import { listRecurringSchedules } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Every recurring schedule that has not ended (Sales report Phase 3).
export async function GET(request: Request) {
  return salesRead(request, "sales.order.view", async (client, context) => listRecurringSchedules(client, context));
}
