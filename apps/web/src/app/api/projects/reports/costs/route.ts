import { getProjectCostReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One project cost report (?kind=summary | by-category | by-task-milestone | by-source | labor | expenses | materials | budget-vs-actual |
// actual-plus-commitments | forecast | profitability | variance-trend | unallocated | corrections | exceptions), with ?projectId=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProjectCostReport(client, context, url.searchParams.get("kind") ?? "summary",
    { projectId: url.searchParams.get("projectId") ?? undefined }) }));
}
