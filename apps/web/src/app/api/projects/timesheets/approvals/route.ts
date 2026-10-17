import { getTimesheetApprovalQueue } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The timesheets waiting for this person's decision (?status=SUBMITTED | APPROVED | CHANGES_REQUESTED).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getTimesheetApprovalQueue(client, context, { status: url.searchParams.get("status") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined }));
}
