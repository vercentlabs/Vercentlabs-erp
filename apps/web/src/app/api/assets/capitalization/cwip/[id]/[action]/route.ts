import { markCwipReady, transferCwip } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST ready { readyAt, evidence } · transfer { assetIds | shares, commandId? }
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "ready": return markCwipReady(client, context, id, input);
      case "transfer": return transferCwip(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
