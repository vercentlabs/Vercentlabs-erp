import { acknowledgeCustody, cancelCustodyHandover, confirmPhysicalHandover, disputeCustody, waiveCustodyAcknowledgment } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST confirm-physical { condition, handedOverAt?, accessories? } · acknowledge { conditionConfirmed?, comment? } · dispute { reason, comment? } · waive { reason } · cancel { reason }
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "confirm-physical": return confirmPhysicalHandover(client, context, id, input);
      case "acknowledge": return acknowledgeCustody(client, context, id, input);
      case "dispute": return disputeCustody(client, context, id, input);
      case "waive": return waiveCustodyAcknowledgment(client, context, id, input);
      case "cancel": return cancelCustodyHandover(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
