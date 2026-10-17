import {
  confirmAssetAcquisitionCost, getAssetExceptions, getAssetRegisterOptions, getAssetRegisterOverview, getAssetRegisterReport,
  bulkAssetStatusAction, getAssetLabels, getAssetStatusExceptions, getIdentificationExceptions, listAssetAcquisitionSources, lookupAsset, markAssetLabelsPrinted, registerAssetsFromSource, reverseAssetAcquisition,
  searchAssetsForPicker,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET overview · options · search (?q= — the asset picker) · labels (?assetIds=&categoryId=&locationId=&batchId=&unlabelled=) · identification-exceptions · status-exceptions · sources (?search=) · exceptions · lookup (?value=) · report (?kind=)
// POST register-from-source · reverse-acquisition { allocationId, reason } · confirm-cost { allocationId, cost? }
//      · labels { assetIds } · labels-printed { assetIds } · bulk-status { action: commission|hold|release|retire, assetIds, …the action's fields, idempotencyKey? }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  // A scan or lookup is a locator, never a credential: guessing identifiers is throttled before anything is read.
  if (action === "lookup" || action === "search") await enforcePublicRateLimits(request, [{ bucket: "asset-lookup", maximum: 120, windowSeconds: 60 }]);
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "overview": return getAssetRegisterOverview(client, context);
      case "options": return getAssetRegisterOptions(client, context);
      case "sources": return listAssetAcquisitionSources(client, context, { search: get("search") });
      case "exceptions": return { rows: await getAssetExceptions(client, context) };
      case "lookup": return lookupAsset(client, context, get("value") ?? "");
      case "search": return searchAssetsForPicker(client, context, { q: get("q"), includeEnded: get("includeEnded") === "true" });
      case "labels": return getAssetLabels(client, context, { assetIds: get("assetIds"), categoryId: get("categoryId"), locationId: get("locationId"), batchId: get("batchId"), unlabelled: get("unlabelled") });
      case "identification-exceptions": return { rows: await getIdentificationExceptions(client, context) };
      case "status-exceptions": return { rows: await getAssetStatusExceptions(client, context) };
      case "report": return { rows: await getAssetRegisterReport(client, context, get("kind") ?? "register") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "register-from-source": return registerAssetsFromSource(client, context, input);
      case "reverse-acquisition": return reverseAssetAcquisition(client, context, String(input.allocationId ?? ""), input);
      case "confirm-cost": return confirmAssetAcquisitionCost(client, context, String(input.allocationId ?? ""), input);
      case "labels": return getAssetLabels(client, context, { assetIds: input.assetIds });
      case "labels-printed": return markAssetLabelsPrinted(client, context, input);
      case "bulk-status": return bulkAssetStatusAction(client, context, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
