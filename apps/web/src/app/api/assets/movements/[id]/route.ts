import { getAssetMovement } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One movement event with the other steps of its transfer or handover and its correction trail.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getAssetMovement(client, context, id));
}
