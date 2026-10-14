import { recordCorrectiveAction, resolveProductionHoldReason } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { reasonActionSchema } from "@/features/manufacturing/holds/api/hold-schemas";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// corrective-action (what is being done) · resolve (cleared by the reason's own authority: production, quality or safety).
export async function POST(request: Request, ctx: { params: Promise<{ reasonId: string; action: string }> }) {
  const { reasonId, action } = await ctx.params;
  return manufacturingMutation(request, reasonActionSchema, async (client, context, input) => {
    switch (action) {
      case "corrective-action": return recordCorrectiveAction(client, context, reasonId, input);
      case "resolve": return resolveProductionHoldReason(client, context, reasonId, input);
      default: throw new HttpError(404, "Unknown hold reason action.", "NOT_FOUND");
    }
  });
}
