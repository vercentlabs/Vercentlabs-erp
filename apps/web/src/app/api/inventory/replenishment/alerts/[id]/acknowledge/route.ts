import { acknowledgeLowStockAlert } from "@vercentlabs/api";
import { STOCK_ALERT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Take responsibility for the alert. The stock condition is unchanged.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.object({ notes: z.string().optional() }), async (client, context, input) => ({ detail: await acknowledgeLowStockAlert(client, context, id, input) }), 200,
    STOCK_ALERT_PERMISSIONS.acknowledge);
}
