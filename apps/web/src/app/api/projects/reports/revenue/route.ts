import { getProjectRevenueReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One project revenue report (?kind=contract-value | invoiced | recognized | unbilled-contract | unbilled-time | milestone-schedule | collections |
// receivables | overdue | by-service-line | by-period | revenue-vs-cost | amendments | credit-notes | exceptions), with ?projectId=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getProjectRevenueReport(client, context, url.searchParams.get("kind") ?? "contract-value",
    { projectId: url.searchParams.get("projectId") ?? undefined }) }));
}
