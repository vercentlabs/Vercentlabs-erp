import { getApprovedUnbilledTime } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Approved, eligible time with minutes free to request (?projectId=, ?contractLineId=, ?all=true for everything approved and eligible).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getApprovedUnbilledTime(client, context, { projectId: url.searchParams.get("projectId") ?? undefined,
    contractLineId: url.searchParams.get("contractLineId") ?? undefined, all: url.searchParams.get("all") === "true" }));
}
