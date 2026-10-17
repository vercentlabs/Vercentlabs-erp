import { checkTimeEntry } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Whether this time can be recorded (the form asks before saving, so the person sees why not).
const schema = z.object({ projectId: z.string().max(64).optional(), taskId: z.string().uuid().nullable().optional(), workDate: z.string().max(10).optional(), durationMinutes: z.number().optional(), hours: z.number().optional(), minutes: z.number().optional(), startTime: z.string().max(5).nullable().optional(), endTime: z.string().max(5).nullable().optional(), description: z.string().max(2000).optional(), billable: z.boolean().nullable().optional(), employeeUserId: z.string().uuid().optional(), contractLineId: z.string().uuid().optional(), billingReasonCode: z.string().max(40).nullable().optional(), billingReasonNote: z.string().max(500).nullable().optional(), classificationReason: z.string().max(500).optional(), entryId: z.string().uuid().optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => checkTimeEntry(client, context, input));
}
