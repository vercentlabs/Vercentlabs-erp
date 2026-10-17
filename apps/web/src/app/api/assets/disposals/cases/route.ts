import { createAssetDisposalCase, listAssetDisposals } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET disposal cases (?view=&search=&assetId=&type=) · POST create { disposalType, reasonCode, explanation, proposedEffectiveDate, assets: [{ assetId | asset, proposedProceeds?, disposalCosts? }], … }
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, (client, context) => listAssetDisposals(client, context, { view: get("view"), search: get("search"), assetId: get("assetId"), type: get("type") }));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createAssetDisposalCase(client, context, input), 201);
}
