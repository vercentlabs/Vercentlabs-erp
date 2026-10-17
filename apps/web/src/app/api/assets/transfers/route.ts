import { createAssetTransfer, listAssetTransfers } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET the directory (?view=&search=&assetId=) · POST create { transferType, reasonCode, …, lines, idempotencyKey?, submit? }
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => listAssetTransfers(client, context, Object.fromEntries(url.searchParams.entries())));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createAssetTransfer(client, context, input));
}
