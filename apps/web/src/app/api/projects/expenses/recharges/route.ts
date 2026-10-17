import { listExpenseRechargeRequests } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Expense recharge requests handed to Sales (?projectId=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ requests: await listExpenseRechargeRequests(client, context, { projectId: url.searchParams.get("projectId") ?? undefined }) }));
}
