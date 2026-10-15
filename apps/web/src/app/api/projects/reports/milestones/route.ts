import { getMilestoneReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One milestone report (?kind=by-project | upcoming | overdue | by-owner | completed | blocked | pending-internal | pending-customer | schedule-changes |
// billing-eligibility | completion-history), with ?projectId= / ?ownerId= filters.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => {
    const filters = Object.fromEntries(["projectId", "ownerId", "search"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
    return { rows: await getMilestoneReport(client, context, url.searchParams.get("kind") ?? "by-project", filters) };
  }, "projects.milestones.view");
}
