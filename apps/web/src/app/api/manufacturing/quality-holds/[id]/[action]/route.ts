import { reinspectHeldOutput, releaseQualityHold } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { holdActionSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// release (the held output awaits inspection again) · reinspect (released, and a new inspection opened over exactly that output).
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, holdActionSchema, async (client, context, input) => {
    switch (action) {
      case "release": {
        const hold = await releaseQualityHold(client, context, id, input);
        return { holdId: hold.id, orderId: hold.manufacturing_order_id };
      }
      case "reinspect": return { inspection: await reinspectHeldOutput(client, context, id, input) };
      default: throw new HttpError(404, "Unknown hold action.", "NOT_FOUND");
    }
  });
}
