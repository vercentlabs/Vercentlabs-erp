import { updatePreventiveMaintenancePlan } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST update { status?, …plan fields, reason }
type Params = { params: Promise<{ planId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { planId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action !== "update") throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    return updatePreventiveMaintenancePlan(client, context, planId, input);
  });
}
