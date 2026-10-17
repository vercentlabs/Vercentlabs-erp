import { getBillableTimeReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One billable-time report (?kind=, ?from, ?to, ?projectId).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getBillableTimeReport(client, context, url.searchParams.get("kind") ?? "billable-vs-nonbillable",
    { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined }) }));
}
