import { listTaskQueue } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Tasks across the projects the person may see (?view=all | open | mine | due_soon | overdue | in_review | my_reviews | blocked | completed | cancelled | archived).
const KEYS = ["view", "projectId", "milestoneId", "assigneeId", "status", "priority", "type", "tag", "search", "due", "sort", "direction", "page", "pageSize"];
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listTaskQueue(client, context,
    Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""))), "projects.tasks.view");
}
