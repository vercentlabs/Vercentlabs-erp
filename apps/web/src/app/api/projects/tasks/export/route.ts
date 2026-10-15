import { exportProjectTasks } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";

// Tasks as CSV, with the queue's filters (what the person may see).
const KEYS = ["view", "projectId", "milestoneId", "assigneeId", "status", "priority", "type", "tag", "search", "due", "sort", "direction", "page", "pageSize"];
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "projects", permission: "projects.tasks.export" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const filters = Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""));
    const file = await exportProjectTasks(client, projectsContext(session), filters);
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
