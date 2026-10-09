import { postGoodsIssue } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Post: re-checked against current stock, issued once. negativeOverride: an authorised negative-stock override (reason and notes) for untracked
// lines the stock does not cover; the stock engine checks the permission, policy and reason itself.
const schema = z.object({ negativeOverride: z.object({ reasonCode: z.string().max(40), notes: z.string().max(2000) }).nullable().optional() }).passthrough();

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, schema, async (client, context, input) => ({ detail: await postGoodsIssue(client, context, id, { negativeOverride: input.negativeOverride ?? null }) }), 200,
    GOODS_ISSUE_PERMISSIONS.post);
}
