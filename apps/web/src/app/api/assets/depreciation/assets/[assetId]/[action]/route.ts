import { generateDepreciationSchedule, previewDepreciationRevision, previewDepreciationSchedule, proposeDepreciationBasis, reviseDepreciationEstimate } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST propose { policyId?, residualValue?, usefulLifeMonths?, commencementDate?, reason } · revise { remainingLifeMonths?, residualValue?, effectiveFrom?, reason }
//      · preview-revision { … } · preview-schedule { residualValue?, usefulLifeMonths?, commencementDate?, policyId? } · generate
type Params = { params: Promise<{ assetId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { assetId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "propose": return proposeDepreciationBasis(client, context, assetId, input);
      case "revise": return reviseDepreciationEstimate(client, context, assetId, input);
      case "preview-revision": return previewDepreciationRevision(client, context, assetId, input);
      case "preview-schedule": return previewDepreciationSchedule(client, context, assetId, input);
      case "generate": return generateDepreciationSchedule(client, context, assetId);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
