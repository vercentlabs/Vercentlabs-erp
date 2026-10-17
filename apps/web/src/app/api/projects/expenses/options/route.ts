import { getExpenseOptions } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// What the expense form needs: categories, the projects the person can claim on, and for one project its tasks (and, for its lead, the team,
// the sales order lines that may authorize a recharge and the goods issues that may be linked).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getExpenseOptions(client, context, { projectId: url.searchParams.get("projectId") ?? undefined }));
}
