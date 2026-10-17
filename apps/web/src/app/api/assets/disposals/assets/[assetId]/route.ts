import { getAssetDisposalPanel } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the asset's disposal: any pending case and its restriction, its cases, and the final outcome with Finance's figures (with permission).
type Params = { params: Promise<{ assetId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { assetId } = await ctx.params;
  return assetsRead(request, (client, context) => getAssetDisposalPanel(client, context, assetId));
}
