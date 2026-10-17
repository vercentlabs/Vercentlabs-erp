import { approveTimeCorrection, rejectTimeCorrection } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Decide a correction: approve (with the Sales adjustment when the time was billed) or reject (with the reason).
type Params = { params: Promise<{ correctionId: string; action: string }> };
const unknown = () => { throw new HttpError(404, "Unknown action.", "NOT_FOUND"); };
const schema = z.object({ note: z.string().max(1000).optional(), billingAdjustmentReference: z.string().max(200).optional(), expectedVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function POST(request: Request, ctx: Params) {
  const { correctionId, action } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => (action === "approve" ? approveTimeCorrection(client, context, correctionId, input)
    : action === "reject" ? rejectTimeCorrection(client, context, correctionId, input) : unknown()));
}
