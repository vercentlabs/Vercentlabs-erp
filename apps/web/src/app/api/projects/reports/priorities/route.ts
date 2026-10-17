import { getPriorityReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One priority report (?kind=distribution | by-priority | by-assignee | by-project | urgent-open | high-priority-overdue | blocked-urgent | completed |
// changes), with ?projectId=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({
    rows: await getPriorityReport(client, context, url.searchParams.get("kind") ?? "distribution", { projectId: url.searchParams.get("projectId") ?? undefined }),
  }), "projects.tasks.view");
}
