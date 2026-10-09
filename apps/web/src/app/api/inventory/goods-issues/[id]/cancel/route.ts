import { cancelDraftGoodsIssue } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Cancel a draft.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await cancelDraftGoodsIssue(client, context, id, { reason: typeof input.reason === "string" ? input.reason : undefined }) }), 200, GOODS_ISSUE_PERMISSIONS.create);
}
