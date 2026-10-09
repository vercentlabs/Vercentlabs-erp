import { acknowledgeLowStockAlerts } from "@vercentlabs/api";
import { STOCK_ALERT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Acknowledge selected alerts (there is no "resolve selected": alerts resolve when the stock condition clears).
export async function POST(request: Request) {
  return inventoryMutation(request, z.object({ alertIds: z.array(z.string()).max(500), notes: z.string().optional() }),
    async (client, context, input) => ({ result: await acknowledgeLowStockAlerts(client, context, input.alertIds, { notes: input.notes }) }), 200, STOCK_ALERT_PERMISSIONS.acknowledge);
}
