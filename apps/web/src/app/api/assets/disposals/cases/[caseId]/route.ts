import { getAssetDisposal } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

type Params = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { caseId } = await ctx.params;
  return assetsRead(request, (client, context) => getAssetDisposal(client, context, caseId));
}
