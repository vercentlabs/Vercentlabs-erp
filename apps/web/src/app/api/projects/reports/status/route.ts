import { getProjectStatusReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One status report (?kind=by-status | active | planned | on-hold | completed | cancelled | status-changes | hold-duration | completion-exceptions | reopened).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProjectStatusReport(client, context, url.searchParams.get("kind") ?? "by-status") }));
}
