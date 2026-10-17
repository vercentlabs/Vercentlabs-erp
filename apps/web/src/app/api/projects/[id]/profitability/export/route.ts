import { exportProjectProfitability } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";

// The project's profitability figures, with their basis, as CSV (?from=&to= for a period).
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  return workspaceRoute(request, { module: "projects", permission: "projects.profitability.export" }, async ({ client, session }) => {
    const file = await exportProjectProfitability(client, projectsContext(session), id, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
