import { decideExpenseCorrection } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Decide a correction of an approved expense: { decision: APPLY | REJECT, note? }.
type Params = { params: Promise<{ correctionId: string }> };
export async function POST(request: Request, ctx: Params) {
  const { correctionId } = await ctx.params;
  return projectsMutation(request, z.object({ decision: z.enum(["APPLY", "REJECT"]), note: z.string().max(1000).optional() }), async (client, context, input) => decideExpenseCorrection(client, context, correctionId, input));
}
