import { respondToMaintenanceRequest, triageMaintenanceRequest } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST triage { decision: ACCEPT | REJECT | NEEDS_INFORMATION | DUPLICATE, note, duplicateOf?, safetyAssessed? } · respond { note }
type Params = { params: Promise<{ requestId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { requestId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "triage": return triageMaintenanceRequest(client, context, requestId, input);
      case "respond": return respondToMaintenanceRequest(client, context, requestId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
