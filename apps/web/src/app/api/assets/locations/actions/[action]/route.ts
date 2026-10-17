import {
  getAssetLocationDiscrepancies, getAssetLocationReport, getLocationChoices, getLocationParties, requestBulkAssetTransfers, resolveAssetLocationDiscrepancy, setInitialAssetLocations,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET choices · parties · discrepancies (?status=OPEN|all) · report (?kind=)
// POST resolve-discrepancy { discrepancyId, resolution, note, toLocationId? } · initial-location { assetIds, locationId } · bulk-transfer { assetIds, toLocationId, reason }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "choices": return { rows: await getLocationChoices(client, context) };
      case "parties": return { rows: await getLocationParties(client, context) };
      case "discrepancies": return getAssetLocationDiscrepancies(client, context, { status: url.searchParams.get("status") ?? undefined });
      case "report": return { rows: await getAssetLocationReport(client, context, url.searchParams.get("kind") ?? "assets-by-location") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "resolve-discrepancy": return resolveAssetLocationDiscrepancy(client, context, String(input.discrepancyId ?? ""), input);
      case "initial-location": return setInitialAssetLocations(client, context, input);
      case "bulk-transfer": return requestBulkAssetTransfers(client, context, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
