import { listMilestoneQueue } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Milestones across the projects the person may see (?view=all | mine | upcoming | overdue | pending_approval | pending_customer | blocked | completed).
const KEYS = ["view", "projectId", "ownerId", "status", "search", "sort", "direction", "page", "pageSize"];
const milestoneFilters = (url: URL) => Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""));
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listMilestoneQueue(client, context, milestoneFilters(url)), "projects.milestones.view");
}
