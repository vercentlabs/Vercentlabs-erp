import { getOpeningTemplate } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// The existing-assets template (?format=xlsx|csv), with one example row.
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  return workspaceRoute(request, { module: "assets", permission: "assets.view" }, async ({ client, session }) => {
    const file = await getOpeningTemplate(client, assetsContext(session), format);
    return new Response(file.body, { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
