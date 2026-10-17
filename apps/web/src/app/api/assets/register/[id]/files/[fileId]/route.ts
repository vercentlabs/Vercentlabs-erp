import { archiveAssetFile, readAssetFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// One asset document: download it, or archive it (kept in history, never deleted).
type Params = { params: Promise<{ id: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "assets", permission: "assets.view" }, async ({ client, session }) => {
    const file = await readAssetFile(client, assetsContext(session), id, fileId);
    return new Response(file.body, { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`, "Cache-Control": "private, no-store" } });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "assets", permission: "assets.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await archiveAssetFile(client, assetsContext(session), id, fileId)) as Record<string, unknown>));
}
