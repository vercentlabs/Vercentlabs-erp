import { getAssetTransfer, updateAssetTransfer } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET one transfer · PATCH a draft { reasonDetail?, plannedDate?, …, removeLineIds?, addLines?, expectedVersion }
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getAssetTransfer(client, context, id));
}
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => updateAssetTransfer(client, context, id, input));
}
