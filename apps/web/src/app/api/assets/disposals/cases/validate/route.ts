import { validateDisposalEligibility } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST { assets: [{ assetId | asset }], disposalType } — every asset checked against its real state; nothing is saved.
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => validateDisposalEligibility(client, context, input));
}
