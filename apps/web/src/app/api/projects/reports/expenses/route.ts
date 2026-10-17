import { getExpenseReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One expense report (?kind=by-project | by-category | my-claims | pending-approval | approved | reimbursement-status | cost-by-source | budget-vs-actual |
// billable-vs-nonbillable | approved-unbilled | duplicates | by-employee | tax-review | corrections | reconciliation), with ?from=&to=&projectId=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ rows: await getExpenseReport(client, context, url.searchParams.get("kind") ?? "by-project",
    Object.fromEntries(["from", "to", "projectId"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value))) }));
}
