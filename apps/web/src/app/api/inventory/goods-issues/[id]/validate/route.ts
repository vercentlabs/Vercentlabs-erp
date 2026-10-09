import { validateGoodsIssue } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Everything posting checks, against stock as it is now.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ validation: await validateGoodsIssue(client, context, id) }), GOODS_ISSUE_PERMISSIONS.view);
}
