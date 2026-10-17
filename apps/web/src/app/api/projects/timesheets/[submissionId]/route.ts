import { getTimesheetSubmission } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One submitted timesheet: the exact versions it carried, the checks, its versions and history.
type Params = { params: Promise<{ submissionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { submissionId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ submission: await getTimesheetSubmission(client, context, submissionId) }));
}
