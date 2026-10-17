import { exportCollaboration } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";

// The visible conversation (filtered like search) as CSV, with the export permission.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "projects", permission: "projects.comments.export" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const filters = Object.fromEntries(["q", "projectId", "parentType", "parentId", "authorId", "from", "to", "hasAttachments"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""));
    const file = await exportCollaboration(client, projectsContext(session), filters);
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
