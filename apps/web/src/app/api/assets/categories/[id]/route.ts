import { getAssetCategory, updateAssetCategory } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// One category: its basic information, operational rules, Finance references (when allowed) and counts; PATCH changes the operational setup.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, async (client, context) => ({ category: await getAssetCategory(client, context, id) }));
}
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => updateAssetCategory(client, context, id, input));
}
