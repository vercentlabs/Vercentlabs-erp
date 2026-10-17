import { createAssetDraft, getAssetRegister } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// The Asset Register directory (?view=&search=&categoryId=&lifecycle=&availability=&condition=&locationId=&departmentId=&custodianId=&ownership=&capitalization=
// &supplierId=&purchasedFrom=&purchasedTo=&warranty=&filter=&archived=&sort=&direction=&page=&pageSize=), and a new draft asset.
const KEYS = ["view", "search", "categoryId", "lifecycle", "availability", "condition", "locationId", "departmentId", "custodianId", "ownership", "capitalization", "supplierId", "purchasedFrom",
  "purchasedTo", "warranty", "filter", "archived", "sort", "direction", "page", "pageSize"];
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, async (client, context) => getAssetRegister(client, context, Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, v]) => v))));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => createAssetDraft(client, context, input), 201);
}
