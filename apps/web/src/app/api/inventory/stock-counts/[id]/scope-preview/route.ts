import { previewCountScope } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Before starting: what the count will cover and freeze, and any active count it would overlap.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ preview: await previewCountScope(client, context, id) }), STOCK_COUNT_PERMISSIONS.view);
}
