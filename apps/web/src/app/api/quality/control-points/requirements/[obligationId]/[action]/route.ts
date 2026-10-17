import { decideObligationConflict, reevaluateObligation, requestQualityWaiver } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// POST reevaluate · decide-conflict · request-waiver on one inspection requirement.
export async function POST(request: Request, ctx: { params: Promise<{ obligationId: string; action: string }> }) {
  const { obligationId, action } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "reevaluate": return reevaluateObligation(client, context, obligationId, input);
      case "decide-conflict": return decideObligationConflict(client, context, obligationId, input);
      case "request-waiver": return requestQualityWaiver(client, context, obligationId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
