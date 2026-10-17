import { getAssetLocation, updateAssetLocation } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// One location: its path, details, counts and child locations; PATCH renames it or changes its details (never its parent).
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, async (client, context) => ({ location: await getAssetLocation(client, context, id) }));
}
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => updateAssetLocation(client, context, id, input));
}
