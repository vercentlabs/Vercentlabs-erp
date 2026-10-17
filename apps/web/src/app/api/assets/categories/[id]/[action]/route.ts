import {
  deactivateAssetCategory, deleteAssetCategory, getAssetCategoryAssets, getAssetCategoryHistory, reactivateAssetCategory, setCategoryFinancialPolicy,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET history · assets
// POST deactivate · reactivate { reason?, expectedVersion? } · delete (never used only) · financial-policy { Finance references…, reason, expectedVersion? }
type Params = { params: Promise<{ id: string; action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsRead(request, async (client, context) => {
    if (action === "history") return getAssetCategoryHistory(client, context, id);
    if (action === "assets") return getAssetCategoryAssets(client, context, id);
    throw new HttpError(404, "Unknown view.", "NOT_FOUND");
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "deactivate": return deactivateAssetCategory(client, context, id, input);
      case "reactivate": return reactivateAssetCategory(client, context, id, input);
      case "delete": return deleteAssetCategory(client, context, id);
      case "financial-policy": return setCategoryFinancialPolicy(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
