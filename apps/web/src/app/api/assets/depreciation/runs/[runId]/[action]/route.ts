import { approveDepreciationRun, cancelDepreciationRun, postDepreciationRun, recalculateDepreciationRun, recoverDepreciationPosting } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST recalculate · approve { note?, expectedVersion? } · post { commandId? } · recover · cancel { reason }
type Params = { params: Promise<{ runId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { runId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "recalculate": return recalculateDepreciationRun(client, context, runId);
      case "approve": return approveDepreciationRun(client, context, runId, input);
      case "post": return postDepreciationRun(client, context, runId, input);
      case "recover": return recoverDepreciationPosting(client, context, runId);
      case "cancel": return cancelDepreciationRun(client, context, runId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
