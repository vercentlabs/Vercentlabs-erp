import { exportProjectProgress } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { listFilters } from "@/features/projects/shared/route-helpers";

// The portfolio's progress as CSV, with the export permission.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "projects", permission: "projects.progress.export" }, async ({ client, session }) => {
    const file = await exportProjectProgress(client, projectsContext(session), listFilters(new URL(request.url)));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
