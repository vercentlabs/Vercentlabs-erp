import { getAssetMovementSource, requestMovementCorrection } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET source — the authoritative record behind the movement (needs the evidence permission) · POST request-correction { field, correctedValue, reason, evidence }
type Params = { params: Promise<{ id: string; action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsRead(request, async (client, context) => {
    if (action === "source") return getAssetMovementSource(client, context, id);
    throw new HttpError(404, "Unknown view.", "NOT_FOUND");
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "request-correction") return requestMovementCorrection(client, context, id, input);
    throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  });
}
