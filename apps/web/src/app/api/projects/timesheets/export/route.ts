import { exportProjectTime } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";

// Approved time (or ?status=) as CSV, within what the person may see.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "projects", permission: "projects.time.export" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const filters = Object.fromEntries(["from", "to", "status", "projectId"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""));
    const file = await exportProjectTime(client, projectsContext(session), filters);
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
