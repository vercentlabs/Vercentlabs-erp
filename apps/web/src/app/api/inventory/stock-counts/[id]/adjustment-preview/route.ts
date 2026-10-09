import { previewCountAdjustment } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// The adjustment completing would post, checked against stock now (reservation conflicts, cost bases, value) — nothing is posted.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ preview: await previewCountAdjustment(client, context, id) }), STOCK_COUNT_PERMISSIONS.view);
}
