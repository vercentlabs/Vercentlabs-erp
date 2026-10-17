import { exportAssetRegister } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// The register as CSV, with the directory's filters; carrying amounts only for those who may see values.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return workspaceRoute(request, { module: "assets", permission: "assets.export" }, async ({ client, session }) => {
    const file = await exportAssetRegister(client, assetsContext(session), Object.fromEntries([...url.searchParams.entries()]));
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
