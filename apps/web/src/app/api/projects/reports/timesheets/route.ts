import { getProjectTimeReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One timesheet report (?kind=my-summary | employee-hours | project-hours | task-hours | billable | approval-status | unsubmitted | exceptions | late |
// labor-cost | unbilled | invoiced | corrections | by-manager, with ?from, ?to, ?projectId).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProjectTimeReport(client, context, url.searchParams.get("kind") ?? "project-hours",
    { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined }) }));
}
