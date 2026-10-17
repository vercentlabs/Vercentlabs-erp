import { approveDepreciationSchedule } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST approve { expectedVersion, note? } — a draft schedule becomes the plan in force (approving the basis it was drafted from).
type Params = { params: Promise<{ scheduleId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { scheduleId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "approve") return approveDepreciationSchedule(client, context, scheduleId, input);
    throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  });
}
