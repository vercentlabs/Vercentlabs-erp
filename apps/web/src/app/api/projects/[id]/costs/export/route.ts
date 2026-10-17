import { exportProjectCost } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";

// The project's cost lines as CSV (labor rates only for those allowed to see them).
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.cost.export" }, async ({ client, session }) => {
    const file = await exportProjectCost(client, projectsContext(session), id);
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
