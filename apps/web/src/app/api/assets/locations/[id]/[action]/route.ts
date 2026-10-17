import {
  deactivateAssetLocation, getAssetLocationChanges, moveAssetLocation, previewAssetLocationDeactivation, previewAssetLocationMove, reactivateAssetLocation,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET history · deactivation-preview
// POST move-preview { parentId } · move { parentId, reason, expectedVersion? } · deactivation-preview · deactivate { reason?, expectedVersion? } · reactivate { reason? }
type Params = { params: Promise<{ id: string; action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsRead(request, async (client, context) => {
    if (action === "history") return getAssetLocationChanges(client, context, id);
    if (action === "deactivation-preview") return previewAssetLocationDeactivation(client, context, id);
    throw new HttpError(404, "Unknown view.", "NOT_FOUND");
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "move-preview": return previewAssetLocationMove(client, context, id, input);
      case "move": return moveAssetLocation(client, context, id, input);
      case "deactivation-preview": return previewAssetLocationDeactivation(client, context, id);
      case "deactivate": return deactivateAssetLocation(client, context, id, input);
      case "reactivate": return reactivateAssetLocation(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
