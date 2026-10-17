import { exportCustody } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// The current custody of every asset as CSV.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "assets", permission: "assets.custody.export" }, async ({ client, session }) => {
    const file = await exportCustody(client, assetsContext(session));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
