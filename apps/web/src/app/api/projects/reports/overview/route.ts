import { getProjectReport } from "@vercentlabs/api";

import { listFilters, projectsRead } from "@/features/projects/shared/route-helpers";

// One overview report (?kind=by-status | by-manager | by-customer | by-priority | near-deadline | overdue | on-hold | task-progress | milestone-summary | completed | activity).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProjectReport(client, context, url.searchParams.get("kind") ?? "by-status", listFilters(url)) }), "projects.reports.view");
}
