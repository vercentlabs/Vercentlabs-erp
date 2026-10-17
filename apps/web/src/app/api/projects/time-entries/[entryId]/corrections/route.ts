import { requestApprovedTimeCorrection } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A correction of approved time (never an edit): the corrected values, or voiding it, with the reason.
type Params = { params: Promise<{ entryId: string }> };
const schema = z.object({ kind: z.enum(["ADJUST", "VOID"]).optional(), projectId: z.string().max(64).optional(), taskId: z.string().uuid().nullable().optional(), workDate: z.string().max(10).optional(), durationMinutes: z.number().optional(), hours: z.number().optional(), minutes: z.number().optional(), startTime: z.string().max(5).nullable().optional(), endTime: z.string().max(5).nullable().optional(), description: z.string().max(2000).optional(), billable: z.boolean().nullable().optional(), employeeUserId: z.string().uuid().optional(), reason: z.string().max(1000), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function POST(request: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => requestApprovedTimeCorrection(client, context, entryId, input), 201);
}
