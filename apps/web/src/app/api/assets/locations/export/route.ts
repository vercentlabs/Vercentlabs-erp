import { exportAssetLocations } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// The location master as CSV.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "assets", permission: "assets.location.export" }, async ({ client, session }) => {
    const file = await exportAssetLocations(client, assetsContext(session));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
