import { getDisposalFinancialPreview } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET each asset's cost, accumulated depreciation, carrying value, proceeds and gain or loss at its derecognition date (nothing is saved).
type Params = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { caseId } = await ctx.params;
  return assetsRead(request, (client, context) => getDisposalFinancialPreview(client, context, caseId));
}
