import { reverseGoodsIssue } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Reverse fully (no lines) or partly (lines), with a reason.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await reverseGoodsIssue(client, context, id, input) }), 200, GOODS_ISSUE_PERMISSIONS.reverse);
}
