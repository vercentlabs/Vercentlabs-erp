import { readNonconformanceEvidence, removeNonconformanceEvidence } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { qualityContext } from "@/features/quality/shared/quality-context";

// One piece of evidence: download it, or remove it until an action refers to it or the NCR is resolved.
type Params = { params: Promise<{ ncId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { ncId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.nonconformance.view" }, async ({ client, session }) => {
    const file = await readNonconformanceEvidence(client, qualityContext(session), ncId, fileId);
    return new Response(new Uint8Array(file.body), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`, "Cache-Control": "private, no-store" } });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { ncId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.nonconformance.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await removeNonconformanceEvidence(client, qualityContext(session), ncId, fileId)) as Record<string, unknown>));
}
