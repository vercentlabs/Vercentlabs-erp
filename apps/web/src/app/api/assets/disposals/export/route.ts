import { exportAssetDisposals } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// Every disposed or pending asset as CSV (Finance's figures only with the disposal-financials permission).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "assets", permission: "assets.disposal.export" }, async ({ client, session }) => {
    const file = await exportAssetDisposals(client, assetsContext(session));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
