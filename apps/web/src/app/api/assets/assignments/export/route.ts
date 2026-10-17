import { exportAssignments } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// Every assignment request as CSV.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "assets", permission: "assets.assignment.export" }, async ({ client, session }) => {
    const file = await exportAssignments(client, assetsContext(session));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
