import { exportDepreciation } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// Depreciation schedules (?kind=schedule&assetId=) or the net book value register (?kind=register) as CSV, with the book named.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return workspaceRoute(request, { module: "assets", permission: "assets.depreciation.export" }, async ({ client, session }) => {
    const file = await exportDepreciation(client, assetsContext(session), { kind: url.searchParams.get("kind") ?? "schedule", assetId: url.searchParams.get("assetId") ?? undefined });
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "private, no-store" } });
  });
}
