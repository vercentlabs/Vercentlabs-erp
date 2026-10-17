import { unlinkDisposalCost } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST { reason } — a disposal cost unlinked before the result is posted.
type Params = { params: Promise<{ linkId: string }> };
export async function POST(request: Request, ctx: Params) {
  const { linkId } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => unlinkDisposalCost(client, context, linkId, input));
}
