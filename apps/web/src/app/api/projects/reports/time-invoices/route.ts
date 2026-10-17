import { getTimeInvoiceReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One invoice-from-time report (?kind=unbilled | reserved | invoiced-by-project | by-customer | by-service | by-period | partially-invoiced | drafts |
// contract-allowance | rate-history | adjustments | duplicate-exceptions | reconciliation | traceability), with ?projectId=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getTimeInvoiceReport(client, context, url.searchParams.get("kind") ?? "unbilled",
    { projectId: url.searchParams.get("projectId") ?? undefined }) }));
}
