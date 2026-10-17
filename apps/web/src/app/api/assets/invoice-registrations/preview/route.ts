import { previewAssetsFromInvoice } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST { invoiceId, lines } — what would be registered, with each line's checks and cost; nothing is created.
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => previewAssetsFromInvoice(client, context, input));
}
