import {
  approveCapitalization, postCapitalization, recoverCapitalizationPosting, rejectCapitalization, requestCapitalizationChanges, resubmitCapitalization, reverseCapitalization,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST approve { treatment?, taxReviewed?, depreciationStartDate?, note?, expectedVersion? } · send-back { note } · resubmit { note? } · reject { reason } · post { postingKey? } · recover · reverse { reason }
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "approve": return approveCapitalization(client, context, id, input);
      case "send-back": return requestCapitalizationChanges(client, context, id, input);
      case "resubmit": return resubmitCapitalization(client, context, id, input);
      case "reject": return rejectCapitalization(client, context, id, input);
      case "post": return postCapitalization(client, context, id, input);
      case "recover": return recoverCapitalizationPosting(client, context, id);
      case "reverse": return reverseCapitalization(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
