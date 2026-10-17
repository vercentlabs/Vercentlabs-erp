import { getAsset, updateAsset } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// One asset: its identity, state, custody and the actions open to the person; PATCH changes the fields its state allows.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, async (client, context) => ({ asset: await getAsset(client, context, id) }));
}
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => updateAsset(client, context, id, input));
}
