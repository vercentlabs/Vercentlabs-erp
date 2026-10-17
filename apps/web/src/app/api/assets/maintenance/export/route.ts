import { exportMaintenance } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// Every Work Order the person may see, as CSV (estimates only with the maintenance-cost permission).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "assets", permission: "assets.maintenance.export" }, async ({ client, session }) => {
    const file = await exportMaintenance(client, assetsContext(session));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
