import { getTeamTimesheets } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// A manager's team week (?week=, ?projectId=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getTeamTimesheets(client, context, { week: url.searchParams.get("week") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined }));
}
