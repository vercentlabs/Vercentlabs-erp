import { exportAssetMovementHistory } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// Movement history as CSV, with the same filters, scope and masking as the screens (?assetId= for one asset).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return workspaceRoute(request, { module: "assets", permission: "assets.movement.export" }, async ({ client, session }) => {
    const file = await exportAssetMovementHistory(client, assetsContext(session), Object.fromEntries(url.searchParams.entries()));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "private, no-store" } });
  });
}
