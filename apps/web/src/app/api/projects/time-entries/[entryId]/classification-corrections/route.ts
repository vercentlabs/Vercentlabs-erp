import { requestBillabilityCorrection } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A correction of approved time's billing classification — or a split of it into billable and non-billable parts — with the reason.
type Params = { params: Promise<{ entryId: string }> };
const part = z.object({ durationMinutes: z.number().int(), billable: z.boolean().optional(), billingReasonCode: z.string().max(40).optional(), billingReasonNote: z.string().max(500).optional(),
  contractLineId: z.string().uuid().optional(), description: z.string().max(2000).optional() });
const schema = z.object({ billable: z.boolean().optional(), billingReasonCode: z.string().max(40).optional(), billingReasonNote: z.string().max(500).optional(), contractLineId: z.string().uuid().optional(),
  parts: z.array(part).max(10).optional(), reason: z.string().max(1000), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function POST(request: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => requestBillabilityCorrection(client, context, entryId, input), 201);
}
