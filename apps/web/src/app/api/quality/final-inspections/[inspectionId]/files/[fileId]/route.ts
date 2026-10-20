import { readInspectionEvidence, removeInspectionEvidence } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { qualityContext } from "@/features/quality/shared/quality-context";

// One piece of evidence: download it, or remove it while the inspection is still being worked on (never once submitted).
type Params = { params: Promise<{ inspectionId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.final.view" }, async ({ client, session }) => {
    const file = await readInspectionEvidence(client, qualityContext(session), inspectionId, fileId);
    return new Response(new Uint8Array(file.body), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`, "Cache-Control": "private, no-store" } });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { inspectionId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.final.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await removeInspectionEvidence(client, qualityContext(session), inspectionId, fileId)) as Record<string, unknown>));
}
