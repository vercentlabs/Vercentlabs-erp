import { getAssetDepreciation } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// An asset's depreciation: basis, schedule (?versionId= for any version) with each month's posting status, financial-year totals and history.
type Params = { params: Promise<{ assetId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { assetId } = await ctx.params;
  const versionId = new URL(request.url).searchParams.get("versionId") ?? undefined;
  return assetsRead(request, (client, context) => getAssetDepreciation(client, context, assetId, { versionId }));
}
