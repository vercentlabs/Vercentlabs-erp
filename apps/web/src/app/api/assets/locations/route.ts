import { createAssetLocation, getAssetLocations } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET the location directory (?status=&kind=&siteId=&hasAssets=&missingManager=&external=&search=) · POST create a location.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => getAssetLocations(client, context, Object.fromEntries(url.searchParams.entries())));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createAssetLocation(client, context, input), 201);
}
