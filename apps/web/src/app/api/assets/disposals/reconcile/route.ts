import { reconcileAssetDisposals } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST re-check every open disposal against custody, transfers, the Sales Invoice, depreciation and Finance's posting; raise or resolve exceptions.
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context) => reconcileAssetDisposals(client, context, {}));
}
