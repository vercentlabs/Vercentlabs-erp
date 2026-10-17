import { getProjectProfitabilityReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One project profitability report (?kind=summary | actual-margin | forecast-margin | profitable-vs-loss | revenue-vs-cost-by-period | cost-breakdown |
// labor-vs-revenue | budget-vs-forecast | margin-history | by-customer | by-manager | completed | exceptions), with ?projectId=, ?status=, ?from=&to=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProjectProfitabilityReport(client, context, url.searchParams.get("kind") ?? "summary", {
    projectId: url.searchParams.get("projectId") ?? undefined, status: url.searchParams.get("status") ?? undefined, from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }) }));
}
