import { getDisposalFinancialSnapshots } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET every calculation version of an asset's disposal (?lineId=): preview, approved, adjustment — posted, superseded or stale.
type Params = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { caseId } = await ctx.params;
  const lineId = new URL(request.url).searchParams.get("lineId") ?? undefined;
  return assetsRead(request, (client, context) => getDisposalFinancialSnapshots(client, context, caseId, { lineId }));
}
