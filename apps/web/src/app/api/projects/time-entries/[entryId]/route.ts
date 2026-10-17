import { deleteDraftTimeEntry, getTimeEntry, updateDraftTimeEntry } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// One time entry: its details, history, corrections and billing; changing or removing it while it is unsubmitted.
type Params = { params: Promise<{ entryId: string }> };
const schema = z.object({ projectId: z.string().max(64).optional(), taskId: z.string().uuid().nullable().optional(), workDate: z.string().max(10).optional(), durationMinutes: z.number().optional(), hours: z.number().optional(), minutes: z.number().optional(), startTime: z.string().max(5).nullable().optional(), endTime: z.string().max(5).nullable().optional(), description: z.string().max(2000).optional(), billable: z.boolean().nullable().optional(), employeeUserId: z.string().uuid().optional(), contractLineId: z.string().uuid().optional(), billingReasonCode: z.string().max(40).nullable().optional(), billingReasonNote: z.string().max(500).nullable().optional(), classificationReason: z.string().max(500).optional(), expectedVersion: z.number().int().optional() });
const removal = z.object({ reason: z.string().max(500).optional(), expectedVersion: z.number().int().optional() });
export async function GET(request: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ entry: await getTimeEntry(client, context, entryId) }));
}
export async function PATCH(request: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => updateDraftTimeEntry(client, context, entryId, input));
}
export async function DELETE(request: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  return projectsMutation(request, removal, async (client, context, input) => deleteDraftTimeEntry(client, context, entryId, input));
}
