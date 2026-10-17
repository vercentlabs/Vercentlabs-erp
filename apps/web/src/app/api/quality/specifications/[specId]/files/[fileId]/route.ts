import { archiveSpecificationFile, readSpecificationFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { qualityContext } from "@/features/quality/shared/quality-context";

// One specification document: download it, or archive it (kept as evidence, never deleted).
type Params = { params: Promise<{ specId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { specId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.view" }, async ({ client, session }) => {
    const file = await readSpecificationFile(client, qualityContext(session), specId, fileId);
    return new Response(file.body, { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`, "Cache-Control": "private, no-store" } });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { specId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await archiveSpecificationFile(client, qualityContext(session), specId, fileId)) as Record<string, unknown>));
}
