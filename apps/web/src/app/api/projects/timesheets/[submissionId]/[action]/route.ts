import { approveTimesheet, requestTimesheetChanges } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Decide a submitted timesheet: approve, or request changes (with the reason and the entries to correct).
type Params = { params: Promise<{ submissionId: string; action: string }> };
const unknown = () => { throw new HttpError(404, "Unknown action.", "NOT_FOUND"); };
const schema = z.object({ comment: z.string().max(2000).optional(), entryIds: z.array(z.string().uuid()).max(500).optional(), expectedVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function POST(request: Request, ctx: Params) {
  const { submissionId, action } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => (action === "approve" ? approveTimesheet(client, context, submissionId, input)
    : action === "request-changes" ? requestTimesheetChanges(client, context, submissionId, input) : unknown()));
}
