import { getProgressReport } from "@vercentlabs/api";

import { listFilters, projectsRead } from "@/features/projects/shared/route-helpers";

// One progress report (?kind=overview | by-manager | task-status | milestones | by-assignee | overdue-blocked | trend | baseline | near-deadline |
// on-hold | completed-outcomes | reopened | estimate-vs-approved | exceptions), over the projects the person may see.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProgressReport(client, context, url.searchParams.get("kind") ?? "overview", listFilters(url)) }));
}
