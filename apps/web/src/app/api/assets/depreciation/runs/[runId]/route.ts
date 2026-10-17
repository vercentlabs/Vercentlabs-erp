import { getDepreciationRun } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One depreciation run: its control summary and every included and excluded asset.
type Params = { params: Promise<{ runId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { runId } = await ctx.params;
  return assetsRead(request, (client, context) => getDepreciationRun(client, context, runId));
}
