import { getTaskReport } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One task report (?kind=by-project | my-open | by-status | by-assignee | overdue | due-soon | high-priority | blocked | in-review | by-milestone |
// completion-trend | reassignments | completion-evidence), with ?projectId=.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => {
    const filters = Object.fromEntries(["projectId", "assigneeId", "search"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
    return { rows: await getTaskReport(client, context, url.searchParams.get("kind") ?? "by-project", filters) };
  }, "projects.tasks.view");
}
