import {
  decideVarianceException, recommendProductionHold, requestAdditionalMaterial, requestBomReview, resolveVarianceException, submitVarianceException,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { exceptionActionSchema } from "@/features/manufacturing/variance/api/variance-schemas";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// submit · decide (APPROVE | REJECT | MORE_EVIDENCE) · resolve · bom-review · recommend-hold (placeHold to hold the order) · request-material.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, exceptionActionSchema, async (client, context, input) => {
    switch (action) {
      case "submit": return submitVarianceException(client, context, id, input);
      case "decide": return decideVarianceException(client, context, id, input);
      case "resolve": return resolveVarianceException(client, context, id, input);
      case "bom-review": return requestBomReview(client, context, id, input);
      case "recommend-hold": return recommendProductionHold(client, context, id, input);
      case "request-material": return requestAdditionalMaterial(client, context, id, input);
      default: throw new HttpError(404, "Unknown variance action.", "NOT_FOUND");
    }
  });
}
