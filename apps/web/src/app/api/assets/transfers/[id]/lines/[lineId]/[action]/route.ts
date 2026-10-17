import { receiveTransferLine, reportTransferException } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST receive { identifier, condition, receivedAt?, handedToCustodian?, notes?, commandId? } · exception { type, description, observedCondition? }
type Params = { params: Promise<{ id: string; lineId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, lineId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "receive": return receiveTransferLine(client, context, id, lineId, input);
      case "exception": return reportTransferException(client, context, id, lineId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
