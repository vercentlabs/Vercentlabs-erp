import { resolveDisposalException } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation } from "@/features/assets/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };
// POST { resolution }
export async function POST(request: Request, ctx: Params) {
  const { exceptionId } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => resolveDisposalException(client, context, exceptionId, input));
}
