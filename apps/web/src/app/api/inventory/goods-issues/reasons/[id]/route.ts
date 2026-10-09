import { updateGoodsIssueReason } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Rename, configure or deactivate a reason (never delete: documents keep it).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ reason: await updateGoodsIssueReason(client, context, id, input) }), 200,
    GOODS_ISSUE_PERMISSIONS.manageReasons);
}
